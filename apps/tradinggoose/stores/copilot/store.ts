'use client'

import { createContext, createElement, type ReactNode, useContext, useMemo } from 'react'
import type { StoreApi } from 'zustand'
import { create, useStore } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  shouldAutoExecuteCopilotTool,
  shouldAutoExecuteIntegrationTool,
} from '@/lib/copilot/access-policy'
import { type CopilotChat, sendStreamingMessage } from '@/lib/copilot/api'
import { mergeCopilotContexts } from '@/lib/copilot/chat-contexts'
import { normalizeFunctionCallArguments } from '@/lib/copilot/function-call-args'
import { DEFAULT_COPILOT_RUNTIME_MODEL } from '@/lib/copilot/runtime-models'
import { resolveCopilotRuntimeProvider } from '@/lib/copilot/runtime-provider'
import { REVIEW_ENTITY_KINDS, type ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { COPILOT_SESSION_KIND } from '@/lib/copilot/session-scope'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { registerToolStateSync } from '@/lib/copilot/tools/client/manager'
import {
  executeCopilotServerTool,
  getCopilotServerToolErrorStatus,
} from '@/lib/copilot/tools/client/server-tool-response'
import { createLogger } from '@/lib/logs/console/logger'
import {
  resetStreamingQueue,
  type SSEHandler,
  type StreamingContext,
  updateStreamingMessage,
} from '@/stores/copilot/streaming'
import {
  maybeHandleCopilotMarkCompleteContinuation,
  registerCopilotMarkCompleteContinuationHandler,
} from '@/stores/copilot/mark-complete'
import {
  getCopilotStoreForToolCall,
  registerCopilotStoreForToolCallResolver,
} from '@/stores/copilot/store-access'
import { reportClientManagedToolFailure } from '@/stores/copilot/tool-failure'
import {
  bindClientToolExecutionContext,
  copilotToolHasInterrupt,
  createExecutionContext,
  ensureClientToolInstance,
  isBackgroundState,
  isCopilotTool,
  isRejectedState,
  isReviewState,
  isServerManagedCopilotTool,
  prepareCopilotToolArgs,
  resolveToolDisplay,
} from '@/stores/copilot/tool-registry'
import { useEnvironmentStore } from '@/stores/settings/environment/store'
import type {
  ChatContext,
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
  MessageFileAttachment,
} from '@/stores/copilot/types'


const logger = createLogger('CopilotStore')

function buildPanelScopedGenericCopilotChatKey(
  channelId: string | null | undefined,
  workspaceId?: string | null
) {
  if (!channelId) {
    return null
  }

  return `${workspaceId ?? 'global'}:${channelId}`
}

function isPanelScopedGenericCopilotChat(
  chat: CopilotChat,
  channelId: string | undefined,
  workspaceId?: string | null
) {
  return (
    chat.channelId === (channelId ?? DEFAULT_COPILOT_CHANNEL_ID) &&
    (chat.workspaceId ?? null) === (workspaceId ?? null) &&
    (!chat.entityKind || chat.entityKind === COPILOT_SESSION_KIND)
  )
}

// Constants
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6
const ACTIVE_TURN_STATUS = 'in_progress'
const COMPLETED_TURN_STATUS = 'completed'

/** All valid ClientToolCallState values accepted when normalizing persisted messages. */
const VALID_TOOL_CALL_STATES = new Set<string>(Object.values(ClientToolCallState))

function normalizeReloadedToolState(
  state: unknown,
  latestTurnStatus?: string | null
): ClientToolCallState {
  const nextState =
    typeof state === 'string' && VALID_TOOL_CALL_STATES.has(state)
      ? (state as ClientToolCallState)
      : ClientToolCallState.rejected

  if (
    nextState === ClientToolCallState.generating ||
    nextState === ClientToolCallState.executing
  ) {
    if (latestTurnStatus === ACTIVE_TURN_STATUS) {
      return nextState
    }
    return ClientToolCallState.aborted
  }

  return nextState
}

function isChatTurnInProgress(chat: Pick<CopilotChat, 'latestTurnStatus'> | null | undefined): boolean {
  return chat?.latestTurnStatus === ACTIVE_TURN_STATUS
}

function buildChatTurnStatusState(
  state: Pick<CopilotStore, 'currentChat' | 'chats'>,
  latestTurnStatus: string
): Pick<CopilotStore, 'currentChat' | 'chats'> {
  const currentChat = state.currentChat
  if (!currentChat) {
    return {
      currentChat,
      chats: state.chats,
    }
  }

  return {
    currentChat: {
      ...currentChat,
      latestTurnStatus,
    },
    chats: state.chats.map((chat) =>
      chat.reviewSessionId === currentChat.reviewSessionId ? { ...chat, latestTurnStatus } : chat
    ),
  }
}

function resolveTurnStatusFromToolCalls(
  toolCallsById: Record<string, CopilotToolCall>
): string {
  const hasActiveToolCall = Object.values(toolCallsById).some((toolCall) => {
    const state = toolCall.state
    return (
      state === ClientToolCallState.generating ||
      state === ClientToolCallState.pending ||
      state === ClientToolCallState.executing ||
      state === ClientToolCallState.review ||
      state === ClientToolCallState.background
    )
  })

  return hasActiveToolCall ? ACTIVE_TURN_STATUS : COMPLETED_TURN_STATUS
}

const pendingChatPersistence = new Map<string, ReturnType<typeof setTimeout>>()

function schedulePersistCurrentChatState(
  get: () => CopilotStore,
  reviewSessionId: string,
  latestTurnStatus: string
) {
  const existing = pendingChatPersistence.get(reviewSessionId)
  if (existing) {
    clearTimeout(existing)
  }

  pendingChatPersistence.set(
    reviewSessionId,
    setTimeout(() => {
      pendingChatPersistence.delete(reviewSessionId)
      void get().saveChatMessages(reviewSessionId, { latestTurnStatus })
    }, 48)
  )
}

type ContextEntityProvenance = {
  workspaceId?: string
  explicit: boolean
}

function isReviewEntityKind(entityKind: string | null | undefined): entityKind is ReviewEntityKind {
  return REVIEW_ENTITY_KINDS.includes(entityKind as ReviewEntityKind)
}

function applyContextEntityProvenance(
  provenance: CopilotToolExecutionProvenance,
  context: ContextEntityProvenance
): boolean {
  const { explicit } = context
  if (context.workspaceId && (explicit || !provenance.workspaceId)) {
    provenance.workspaceId = context.workspaceId
  }

  return Boolean(context.workspaceId)
}

function getContextEntityProvenance(context: ChatContext): ContextEntityProvenance | null {
  const rawKind = context.kind.startsWith('current_')
    ? context.kind.slice('current_'.length)
    : context.kind
  if (!isReviewEntityKind(rawKind)) return null

  const current = context.kind.startsWith('current_')
  const typedContext = context as any
  return {
    workspaceId: typedContext.workspaceId,
    explicit: !current,
  }
}

function buildTurnProvenanceFromContexts(
  channelId: string,
  contexts: ChatContext[] | undefined,
  workspaceId?: string | null
): CopilotToolExecutionProvenance | undefined {
  const normalizedWorkspaceId =
    typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : undefined
  const provenance: CopilotToolExecutionProvenance = {
    channelId,
    ...(normalizedWorkspaceId ? { workspaceId: normalizedWorkspaceId } : {}),
  }
  let hasContext = !!normalizedWorkspaceId

  for (const context of contexts ?? []) {
    const entityContext = getContextEntityProvenance(context)
    if (entityContext) {
      hasContext = applyContextEntityProvenance(provenance, entityContext) || hasContext
    }
  }

  return hasContext ? provenance : undefined
}

function withPinnedToolExecutionProvenance(
  toolCall: CopilotToolCall,
  baseProvenance?: CopilotToolExecutionProvenance
): CopilotToolCall {
  const explicitWorkflowId =
    typeof toolCall.params?.workflowId === 'string' && toolCall.params.workflowId.trim()
      ? toolCall.params.workflowId.trim()
      : undefined
  const explicitEntityId =
    typeof toolCall.params?.entityId === 'string' && toolCall.params.entityId.trim()
      ? toolCall.params.entityId.trim()
      : undefined

  if (toolCall.provenance) {
    return toolCall
  }

  if (!baseProvenance && !explicitWorkflowId && !explicitEntityId) {
    return toolCall
  }

  return {
    ...toolCall,
    provenance: {
      channelId: baseProvenance?.channelId ?? DEFAULT_COPILOT_CHANNEL_ID,
      ...(baseProvenance ?? {}),
      ...(explicitWorkflowId ? { workflowId: explicitWorkflowId } : {}),
      ...(explicitEntityId ? { entityId: explicitEntityId } : {}),
    },
  }
}

function findAssistantMessageIdForToolCall(messages: CopilotMessage[], toolCallId: string): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue

    if (Array.isArray(message.toolCalls) && message.toolCalls.some((toolCall) => toolCall.id === toolCallId)) {
      return message.id
    }

    if (
      Array.isArray(message.contentBlocks) &&
      message.contentBlocks.some(
        (block) => block.type === 'tool_call' && block.toolCall?.id === toolCallId
      )
    ) {
      return message.id
    }
  }

  return null
}

async function postCopilotMarkComplete(params: {
  toolCallId: string
  toolName: string
  status: number
  message?: unknown
  data?: unknown
}): Promise<Response> {
  const response = await fetch('/api/copilot/tools/mark-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: params.toolCallId,
      name: params.toolName,
      status: params.status,
      message: params.message,
      data: params.data,
    }),
  })

  if (response.ok) {
    await maybeHandleCopilotMarkCompleteContinuation({
      toolCallId: params.toolCallId,
      response,
    })
  }

  return response
}

// Helper: abort all in-progress client tools and keep message-level tool state aligned.
function abortAllInProgressTools(set: any, get: () => CopilotStore) {
  try {
    const { toolCallsById } = get()
    const updatedMap = { ...toolCallsById }
    const abortedIds: string[] = []
    for (const [id, tc] of Object.entries(toolCallsById)) {
      const st = tc.state as any
      // Abort anything not already terminal success/error/rejected/aborted
      const isTerminal =
        st === ClientToolCallState.success ||
        st === ClientToolCallState.error ||
        st === ClientToolCallState.rejected ||
        st === ClientToolCallState.aborted
      if (!isTerminal || isReviewState(st)) {
        abortedIds.push(id)
        updatedMap[id] = {
          ...tc,
          state: ClientToolCallState.aborted,
          display: resolveToolDisplay(tc.name, ClientToolCallState.aborted, id, (tc as any).params),
        }
      }
    }
    if (abortedIds.length > 0) {
      set((s: CopilotStore) => {
        const latestTurnStatus = resolveTurnStatusFromToolCalls(updatedMap)
        const nextChatState = buildChatTurnStatusState(s, latestTurnStatus)
        let nextMessages = s.messages
        for (const toolCallId of abortedIds) {
          nextMessages = updateMessagesForToolCallState(
            nextMessages,
            toolCallId,
            ClientToolCallState.aborted
          )
        }

        const nextCurrentChat = nextChatState.currentChat
          ? {
              ...nextChatState.currentChat,
              messages: nextMessages,
            }
          : null

        return {
          toolCallsById: updatedMap,
          messages: nextMessages,
          chats: nextChatState.chats,
          currentChat: nextCurrentChat,
        }
      })
    }
  } catch {}
}

function autoExecuteEligibleToolsForAccessLevel(
  accessLevel: CopilotStore['accessLevel'],
  get: () => CopilotStore
) {
  if (accessLevel !== 'full') {
    return
  }

  const { toolCallsById } = get()
  const copilotToolIds: string[] = []
  const integrationToolIds: string[] = []

  for (const [id, toolCall] of Object.entries(toolCallsById)) {
    const state = toolCall.state
    const isAwaitingApproval =
      state === ClientToolCallState.pending || state === ClientToolCallState.review

    if (!isAwaitingApproval) {
      continue
    }

    if (isCopilotTool(toolCall.name)) {
      const hasInterrupt = copilotToolHasInterrupt(toolCall.name, id)
      if (shouldAutoExecuteCopilotTool(accessLevel, hasInterrupt)) {
        copilotToolIds.push(id)
      }
      continue
    }

    if (shouldAutoExecuteIntegrationTool(accessLevel)) {
      integrationToolIds.push(id)
    }
  }

  if (copilotToolIds.length === 0 && integrationToolIds.length === 0) {
    return
  }

  logger.info('[copilot access] auto-executing queued tools after access change', {
    accessLevel,
    copilotToolIds,
    integrationToolIds,
  })

  for (const toolCallId of copilotToolIds) {
    setTimeout(() => {
      const latest = get().toolCallsById[toolCallId]
      if (!latest) return
      const state = latest.state
      if (state !== ClientToolCallState.pending && state !== ClientToolCallState.review) {
        return
      }
      void get().executeCopilotToolCall(toolCallId)
    }, 0)
  }

  for (const toolCallId of integrationToolIds) {
    setTimeout(() => {
      const latest = get().toolCallsById[toolCallId]
      if (!latest) return
      if (latest.state !== ClientToolCallState.pending) {
        return
      }
      void get().executeIntegrationTool(toolCallId)
    }, 0)
  }
}

// Normalize loaded messages so assistant messages render correctly from DB
function normalizeMessagesForUI(
  messages: CopilotMessage[],
  latestTurnStatus?: string | null
): CopilotMessage[] {
  try {
    return messages.map((message) => {
      if (message.role !== 'assistant') {
        // For user messages (and others), restore contexts from a saved contexts block
        if (Array.isArray(message.contentBlocks) && message.contentBlocks.length > 0) {
          const ctxBlock = (message.contentBlocks as any[]).find((b: any) => b?.type === 'contexts')
          if (ctxBlock && Array.isArray((ctxBlock as any).contexts)) {
            return {
              ...message,
              contexts: (ctxBlock as any).contexts,
            }
          }
        }
        return message
      }

      // Use existing contentBlocks ordering if present; otherwise only render text content
      const blocks: any[] = Array.isArray(message.contentBlocks)
        ? (message.contentBlocks as any[]).map((b: any) => {
            if (b?.type === 'tool_call' && b.toolCall) {
              const normalizedToolCall = {
                ...b.toolCall,
                state: normalizeReloadedToolState(b.toolCall?.state, latestTurnStatus),
              }
              // Ensure client tool instance is registered for this tool call
              const instance = ensureClientToolInstance(
                normalizedToolCall?.name,
                normalizedToolCall?.id
              )
              instance?.hydratePersistedToolCall?.(normalizedToolCall)

              return {
                ...b,
                toolCall: {
                  ...normalizedToolCall,
                  display: resolveToolDisplay(
                    normalizedToolCall?.name,
                    normalizedToolCall.state,
                    normalizedToolCall?.id,
                    normalizedToolCall?.params
                  ),
                  ...(normalizedToolCall?.result !== undefined
                    ? { result: normalizedToolCall.result }
                    : {}),
                },
              }
            }
            return b
          })
        : []

      // Prepare toolCalls with display for non-block UI components, but do not fabricate blocks
      const updatedToolCalls = Array.isArray((message as any).toolCalls)
        ? (message as any).toolCalls.map((tc: any) => {
            const normalizedToolCall = {
              ...tc,
              state: normalizeReloadedToolState(tc?.state, latestTurnStatus),
            }
            // Ensure client tool instance is registered for this tool call
            const instance = ensureClientToolInstance(
              normalizedToolCall?.name,
              normalizedToolCall?.id
            )
            instance?.hydratePersistedToolCall?.(normalizedToolCall)

            return {
              ...normalizedToolCall,
              display: resolveToolDisplay(
                normalizedToolCall?.name,
                normalizedToolCall.state,
                normalizedToolCall?.id,
                normalizedToolCall?.params
              ),
              ...(normalizedToolCall?.result !== undefined
                ? { result: normalizedToolCall.result }
                : {}),
            }
          })
        : (message as any).toolCalls

      return {
        ...message,
        ...(updatedToolCalls && { toolCalls: updatedToolCalls }),
        ...(blocks.length > 0
          ? { contentBlocks: blocks }
          : message.content?.trim()
            ? { contentBlocks: [{ type: 'text', content: message.content, timestamp: Date.now() }] }
            : {}),
      }
    })
  } catch {
    return messages
  }
}

function buildPinnedToolCallsById(
  messages: CopilotMessage[],
  opts: {
    channelId: string
    workspaceId?: string | null
  }
): Record<string, CopilotToolCall> {
  const toolCallsById: Record<string, CopilotToolCall> = {}
  let turnProvenance: CopilotToolExecutionProvenance | undefined
  const pinToolCall = (toolCall: CopilotToolCall | null | undefined) => {
    if (!toolCall?.id) {
      return
    }

    toolCallsById[toolCall.id] = withPinnedToolExecutionProvenance(toolCall, turnProvenance)
  }

  for (const message of messages) {
    if (message.role === 'user') {
      turnProvenance = buildTurnProvenanceFromContexts(
        opts.channelId,
        Array.isArray((message as any).contexts)
          ? ((message as any).contexts as ChatContext[])
          : undefined,
        opts.workspaceId
      )
      continue
    }

    if (Array.isArray((message as any).toolCalls)) {
      for (const toolCall of (message as any).toolCalls as CopilotToolCall[]) {
        pinToolCall(toolCall)
      }
    }

    if (!message.contentBlocks) continue

    for (const block of message.contentBlocks as any[]) {
      if (block?.type !== 'tool_call') continue
      pinToolCall(block.toolCall)
    }
  }

  return toolCallsById
}

function updateMessagesForToolCallState(
  messages: CopilotMessage[],
  toolCallId: string,
  nextState: ClientToolCallState,
  options?: { result?: any }
): CopilotMessage[] {
  let found = false
  const result: CopilotMessage[] = new Array(messages.length)
  for (let i = 0; i < messages.length; i++) {
    if (found) {
      result[i] = messages[i]
      continue
    }

    const message = messages[i]
    if (message.role !== 'assistant') {
      result[i] = message
      continue
    }

    let blocksChanged = false
    const contentBlocks = Array.isArray(message.contentBlocks)
      ? message.contentBlocks.map((block: any) => {
          if (block?.type !== 'tool_call' || block.toolCall?.id !== toolCallId) {
            return block
          }

          blocksChanged = true
          return {
            ...block,
            toolCall: {
              ...block.toolCall,
              state: nextState,
              display: resolveToolDisplay(
                block.toolCall?.name,
                nextState,
                toolCallId,
                block.toolCall?.params
              ),
              ...(options?.result !== undefined ? { result: options.result } : {}),
            },
          }
        })
      : message.contentBlocks

    const toolCalls = Array.isArray((message as any).toolCalls)
      ? (message as any).toolCalls.map((toolCall: any) => {
          if (toolCall?.id !== toolCallId) {
            return toolCall
          }

          blocksChanged = true
          return {
            ...toolCall,
            state: nextState,
            display: resolveToolDisplay(toolCall?.name, nextState, toolCallId, toolCall?.params),
            ...(options?.result !== undefined ? { result: options.result } : {}),
          }
        })
      : (message as any).toolCalls

    if (!blocksChanged) {
      result[i] = message
      continue
    }

    found = true
    result[i] = {
      ...message,
      ...(contentBlocks ? { contentBlocks } : {}),
      ...(toolCalls ? { toolCalls } : {}),
    }
  }
  return result
}

type StreamingBlock = NonNullable<CopilotMessage['contentBlocks']>[number] & {
  itemId?: string
}

function getOutputItemText(item: Record<string, unknown>, contentType: string): string {
  const content = Array.isArray(item.content) ? item.content : []
  for (const entry of content) {
    if (!entry || typeof entry !== 'object') continue
    const typedEntry = entry as Record<string, unknown>
    if (typedEntry.type === contentType && typeof typedEntry.text === 'string') {
      return typedEntry.text
    }
  }
  return ''
}

function ensureStreamingTextBlock(context: StreamingContext, itemId: string): any {
  const existing = context.textBlocksByItemId.get(itemId)
  if (existing) return existing
  const block = {
    type: TEXT_BLOCK_TYPE,
    content: '',
    timestamp: Date.now(),
    itemId,
  }
  context.contentBlocks.push(block)
  context.textBlocksByItemId.set(itemId, block)
  return block
}

function ensureStreamingThinkingBlock(context: StreamingContext, itemId: string): any {
  const existing = context.thinkingBlocksByItemId.get(itemId)
  if (existing) return existing
  const block = {
    type: THINKING_BLOCK_TYPE,
    content: '',
    timestamp: Date.now(),
    itemId,
    startTime: Date.now(),
  }
  context.contentBlocks.push(block)
  context.thinkingBlocksByItemId.set(itemId, block)
  return block
}

function hydrateStreamingBlockIndexes(context: StreamingContext) {
  for (const block of context.contentBlocks as StreamingBlock[]) {
    if (!block?.itemId) continue
    if (block.type === TEXT_BLOCK_TYPE) {
      context.textBlocksByItemId.set(block.itemId, block)
    } else if (block.type === THINKING_BLOCK_TYPE) {
      context.thinkingBlocksByItemId.set(block.itemId, block)
    }
  }
}

function getStreamingAssistantContent(context: StreamingContext): string {
  return context.contentBlocks
    .filter((block: any) => block?.type === TEXT_BLOCK_TYPE)
    .map((block: any) => String(block.content || ''))
    .join('')
}

function applyStreamedFunctionCallItem(
  item: Record<string, unknown>,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) {
  const id = typeof item.call_id === 'string' ? item.call_id : ''
  const name = typeof item.name === 'string' ? item.name : ''
  if (!id || !name) return

  const args = normalizeFunctionCallArguments(item.arguments)

  const { toolCallsById } = get()

  ensureClientToolInstance(name, id)

  const existing = toolCallsById[id]
  const nextBase: CopilotToolCall = existing
    ? {
        ...existing,
        state: ClientToolCallState.pending,
        ...(args ? { params: args } : {}),
        display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
      }
    : {
        id,
        name,
        state: ClientToolCallState.pending,
        ...(args ? { params: args } : {}),
        display: resolveToolDisplay(name, ClientToolCallState.pending, id, args),
      }

  const next: CopilotToolCall = withPinnedToolExecutionProvenance(nextBase, context.provenance)

  set({ toolCallsById: { ...toolCallsById, [id]: next } })
  logger.info('[toolCallsById] → pending', { id, name, params: args })

  let found = false
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const block = context.contentBlocks[i] as any
    if (block.type === 'tool_call' && block.toolCall?.id === id) {
      context.contentBlocks[i] = { ...block, toolCall: next }
      found = true
      break
    }
  }
  if (!found) {
    context.contentBlocks.push({ type: 'tool_call', toolCall: next, timestamp: Date.now() })
  }
  updateStreamingMessage(set, context)

  const provenance = next.provenance
  if (!provenance) {
    logger.warn('Skipping unpinned tool call execution', { id, name })
    return
  }

  const executionContext = createExecutionContext({
    toolCallId: id,
    toolName: name,
    provenance,
  })

  try {
    bindClientToolExecutionContext(id, executionContext)
  } catch (error) {
    logger.warn('Failed to bind execution context', { id, name, error })
  }

  if (isCopilotTool(name)) {
    try {
      const hasInterrupt = copilotToolHasInterrupt(name, id)
      const { accessLevel } = get()
      if (shouldAutoExecuteCopilotTool(accessLevel, hasInterrupt)) {
        setTimeout(() => {
          get().executeCopilotToolCall(id)
        }, 0)
      } else {
        logger.info('[copilot access] copilot tool awaiting confirmation', {
          accessLevel,
          id,
          name,
        })
      }
    } catch (error) {
      logger.warn('Copilot tool auto-exec check failed', { id, name, error })
    }
    return
  }

  try {
    const { accessLevel } = get()
    if (shouldAutoExecuteIntegrationTool(accessLevel)) {
      logger.info('[copilot access] auto-executing integration tool', {
        accessLevel,
        id,
        name,
      })
      setTimeout(() => {
        get().executeIntegrationTool(id)
      }, 0)
    } else {
      logger.info('[copilot access] integration tool awaiting confirmation', {
        accessLevel,
        id,
        name,
      })
    }
  } catch (error) {
    logger.warn('Integration tool access check failed', { id, name, error })
  }
}

// Helpers
function createUserMessage(
  content: string,
  fileAttachments?: MessageFileAttachment[],
  contexts?: ChatContext[],
  messageId?: string
): CopilotMessage {
  return {
    id: messageId || crypto.randomUUID(),
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    ...(fileAttachments && fileAttachments.length > 0 && { fileAttachments }),
    ...(contexts && contexts.length > 0 && { contexts }),
    ...(contexts &&
      contexts.length > 0 && {
        contentBlocks: [
          { type: 'contexts', contexts: contexts as any, timestamp: Date.now() },
        ] as any,
      }),
  }
}

function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

function createErrorMessage(messageId: string, content: string): CopilotMessage {
  return {
    id: messageId,
    role: 'assistant',
    content,
    timestamp: new Date().toISOString(),
    contentBlocks: [
      {
        type: 'text',
        content,
        timestamp: Date.now(),
      },
    ],
  }
}

function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return messages
    .map((msg) => {
      // Build content from blocks if assistant content is empty (exclude thinking)
      let content = msg.content || ''
      if (msg.role === 'assistant' && !content.trim() && msg.contentBlocks?.length) {
        content = msg.contentBlocks
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => String(b.content || ''))
          .join('')
          .trim()
      }

      // Strip thinking tags from content
      if (content) {
        content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
      }

      return {
        id: msg.id,
        role: msg.role,
        content,
        timestamp: msg.timestamp,
        ...(Array.isArray((msg as any).toolCalls) &&
          (msg as any).toolCalls.length > 0 && {
            toolCalls: (msg as any).toolCalls,
          }),
        ...(Array.isArray(msg.citations) &&
          msg.citations.length > 0 && {
            citations: msg.citations,
          }),
        ...(Array.isArray(msg.contentBlocks) &&
          msg.contentBlocks.length > 0 && {
            // Persist full contentBlocks including thinking so history can render it
            contentBlocks: msg.contentBlocks,
          }),
        ...(msg.fileAttachments &&
          msg.fileAttachments.length > 0 && {
            fileAttachments: msg.fileAttachments,
          }),
        ...((msg as any).contexts &&
          Array.isArray((msg as any).contexts) && {
            contexts: (msg as any).contexts,
          }),
      }
    })
    .filter((m) => {
      if (m.role === 'assistant') {
        const hasText = typeof m.content === 'string' && m.content.trim().length > 0
        const hasTools = Array.isArray((m as any).toolCalls) && (m as any).toolCalls.length > 0
        const hasBlocks =
          Array.isArray((m as any).contentBlocks) && (m as any).contentBlocks.length > 0
        return hasText || hasTools || hasBlocks
      }
      return true
    })
}

const sseHandlers: Record<string, SSEHandler> = {
  review_session_id: async (data, context, get) => {
    context.newReviewSessionId = data.reviewSessionId
    const { currentChat } = get()
    if (!currentChat && context.newReviewSessionId) {
      await get().handleNewReviewSessionCreation(context.newReviewSessionId)
    }
  },
  title_updated: (data, _context, get, set) => {
    const title = typeof data?.title === 'string' ? data.title : ''
    if (!title) return

    const { currentChat, chats } = get()
    if (!currentChat) return

    set({
      currentChat: { ...currentChat, title },
      chats: (chats || []).map((chat) =>
        chat.reviewSessionId === currentChat.reviewSessionId ? { ...chat, title } : chat
      ),
    })
  },
  start: (data, _context, get, set) => {
    const conversationId = data?.data?.conversationId
    if (!conversationId) return
    const { currentChat, chats } = get()
    if (!currentChat) return
    if (currentChat.conversationId) return
    set({
      currentChat: { ...currentChat, conversationId },
      chats: (chats || []).map((chat) =>
        chat.reviewSessionId === currentChat.reviewSessionId ? { ...chat, conversationId } : chat
      ),
    })
  },
  tool_result: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const success: boolean | undefined = data?.success
      const failedDependency: boolean = data?.failedDependency === true
      const skipped: boolean = data?.result?.skipped === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          // Preserve terminal review/rejected state; do not override
          return
        }
        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })

        // If checkoff_todo succeeded, mark todo as completed in planTodos
        if (targetState === ClientToolCallState.success && current.name === 'checkoff_todo') {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'completed')
            }
          } catch {}
        }

        // If mark_todo_in_progress succeeded, set todo executing in planTodos
        if (
          targetState === ClientToolCallState.success &&
          current.name === 'mark_todo_in_progress'
        ) {
          try {
            const result = data?.result || data?.data?.result || {}
            const input = (current as any).params || (current as any).input || {}
            const todoId = input.id || input.todoId || result.id || result.todoId
            if (todoId) {
              get().updatePlanTodoStatus(todoId, 'executing')
            }
          } catch {}
        }
      }

      // Update inline content block state
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = success
            ? ClientToolCallState.success
            : failedDependency || skipped
              ? ClientToolCallState.rejected
              : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)

      const currentChat = get().currentChat
      if (currentChat?.reviewSessionId) {
        schedulePersistCurrentChatState(get, currentChat.reviewSessionId, ACTIVE_TURN_STATUS)
      }
    } catch {}
  },
  tool_error: (data, context, get, set) => {
    try {
      const toolCallId: string | undefined = data?.toolCallId || data?.data?.id
      const failedDependency: boolean = data?.failedDependency === true
      if (!toolCallId) return
      const { toolCallsById } = get()
      const current = toolCallsById[toolCallId]
      if (current) {
        if (
          isRejectedState(current.state) ||
          isReviewState(current.state) ||
          isBackgroundState(current.state)
        ) {
          return
        }
        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error
        const updatedMap = { ...toolCallsById }
        updatedMap[toolCallId] = {
          ...current,
          state: targetState,
          display: resolveToolDisplay(
            current.name,
            targetState,
            current.id,
            (current as any).params
          ),
        }
        set({ toolCallsById: updatedMap })
      }
      for (let i = 0; i < context.contentBlocks.length; i++) {
        const b = context.contentBlocks[i] as any
        if (b?.type === 'tool_call' && b?.toolCall?.id === toolCallId) {
          if (
            isRejectedState(b.toolCall?.state) ||
            isReviewState(b.toolCall?.state) ||
            isBackgroundState(b.toolCall?.state)
          )
            break
          const targetState = failedDependency
            ? ClientToolCallState.rejected
            : ClientToolCallState.error
          context.contentBlocks[i] = {
            ...b,
            toolCall: {
              ...b.toolCall,
              state: targetState,
              display: resolveToolDisplay(
                b.toolCall?.name,
                targetState,
                toolCallId,
                b.toolCall?.params
              ),
            },
          }
          break
        }
      }
      updateStreamingMessage(set, context)

      const currentChat = get().currentChat
      if (currentChat?.reviewSessionId) {
        schedulePersistCurrentChatState(get, currentChat.reviewSessionId, ACTIVE_TURN_STATUS)
      }
    } catch {}
  },
  'response.output_item.added': (data, context, _get, set) => {
    const item = data?.item
    if (!item || typeof item !== 'object') return

    if (item.type === 'message' && item.role === 'assistant' && typeof item.id === 'string') {
      const block = ensureStreamingTextBlock(context, item.id)
      const initialText = getOutputItemText(item, 'output_text')
      if (initialText && !block.content) {
        block.content = initialText
      }
      updateStreamingMessage(set, context)
      return
    }

    if (item.type === 'reasoning' && typeof item.id === 'string') {
      const block = ensureStreamingThinkingBlock(context, item.id)
      const initialText = getOutputItemText(item, 'reasoning_text')
      if (initialText && !block.content) {
        block.content = initialText
      }
      updateStreamingMessage(set, context)
    }
  },
  'response.output_text.delta': (data, context, _get, set) => {
    if (typeof data?.item_id !== 'string' || typeof data?.delta !== 'string' || !data.delta) {
      return
    }
    const block = ensureStreamingTextBlock(context, data.item_id)
    block.content += data.delta
    updateStreamingMessage(set, context)
  },
  'response.reasoning_text.delta': (data, context, _get, set) => {
    if (typeof data?.item_id !== 'string' || typeof data?.delta !== 'string' || !data.delta) {
      return
    }
    const block = ensureStreamingThinkingBlock(context, data.item_id)
    block.content += data.delta
    updateStreamingMessage(set, context)
  },
  'response.output_item.done': (data, context, get, set) => {
    const item = data?.item
    if (!item || typeof item !== 'object') return

    if (item.type === 'message' && item.role === 'assistant' && typeof item.id === 'string') {
      const block = ensureStreamingTextBlock(context, item.id)
      block.content = getOutputItemText(item, 'output_text')
      updateStreamingMessage(set, context)
      return
    }

    if (item.type === 'reasoning' && typeof item.id === 'string') {
      const block = ensureStreamingThinkingBlock(context, item.id)
      block.content = getOutputItemText(item, 'reasoning_text')
      block.duration = Date.now() - (block.startTime || Date.now())
      updateStreamingMessage(set, context)
      return
    }

    if (item.type === 'function_call') {
      applyStreamedFunctionCallItem(item as Record<string, unknown>, context, get, set)
    }
  },
  'response.completed': (_data, context) => {
    context.streamComplete = true
  },
  error: (data, context, _get, set) => {
    logger.error('Stream error:', data.error)
    const content = getStreamingAssistantContent(context) || 'An error occurred.'
    set((state: CopilotStore) => ({
      messages: state.messages.map((msg) =>
        msg.id === context.messageId
          ? {
              ...msg,
              content,
              error: data.error,
            }
          : msg
      ),
    }))
    context.streamComplete = true
  },
  awaiting_tools: (_data, context) => {
    context.awaitingTools = true
    context.streamComplete = true
  },
  stream_end: (_data, context, _get, set) => {
    for (const block of context.contentBlocks as any[]) {
      if (block?.type === THINKING_BLOCK_TYPE && block.startTime && block.duration === undefined) {
        block.duration = Date.now() - block.startTime
      }
    }
    updateStreamingMessage(set, context)
  },
  default: () => {},
}

async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder
) {
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    buffer += chunk
    const lastNewlineIndex = buffer.lastIndexOf('\n')
    if (lastNewlineIndex !== -1) {
      const linesToProcess = buffer.substring(0, lastNewlineIndex)
      buffer = buffer.substring(lastNewlineIndex + 1)
      const lines = linesToProcess.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.length === 0) continue
        if (line.charCodeAt(0) === 100 && line.startsWith(DATA_PREFIX)) {
          try {
            const jsonStr = line.substring(DATA_PREFIX_LENGTH)
            yield JSON.parse(jsonStr)
          } catch (error) {
            logger.warn('Failed to parse SSE data:', error)
          }
        }
      }
    }
  }
}

// Initial state (subset required for UI/streaming)
const initialState = {
  accessLevel: 'limited' as const,
  selectedModel: DEFAULT_COPILOT_RUNTIME_MODEL,
  agentPrefetch: false,
  isCollapsed: false,
  currentChat: null as CopilotChat | null,
  chats: [] as CopilotChat[],
  messages: [] as CopilotMessage[],
  liveContext: {
    workflowId: null,
    workspaceId: null,
  },
  isLoading: false,
  isLoadingChats: false,
  isSendingMessage: false,
  isSaving: false,
  isAborting: false,
  error: null as string | null,
  saveError: null as string | null,
  implicitContexts: [] as ChatContext[],
  abortController: null as AbortController | null,
  chatsLastLoadedAt: null as Date | null,
  chatsLoadedForScope: null as string | null,
  revertState: null as { messageId: string; messageContent: string } | null,
  inputValue: '',
  planTodos: [] as Array<{ id: string; content: string; completed?: boolean; executing?: boolean }>,
  showPlanTodos: false,
  toolCallsById: {} as Record<string, CopilotToolCall>,
  suppressAutoSelect: false,
  contextUsage: null,
}

const createCopilotStoreInstance = (storeChannelId = DEFAULT_COPILOT_CHANNEL_ID) =>
  create<CopilotStore>()(
    devtools((set, get) => ({
      ...initialState,

      // Access policy controls
      setAccessLevel: (accessLevel) => {
        const previousAccessLevel = get().accessLevel
        set({ accessLevel })
        if (previousAccessLevel !== accessLevel) {
          autoExecuteEligibleToolsForAccessLevel(accessLevel, get)
        }
      },

      // Clear messages
      clearMessages: () => set({ messages: [], contextUsage: null }),

      setLiveContext: (context) =>
        set((state) => ({
          liveContext: {
            ...state.liveContext,
            ...context,
          },
        })),

      // Chats (minimal implementation for visibility)
      validateCurrentChat: () => {
        const { currentChat, chats } = get()
        if (!currentChat) return false
        const chatExists = chats.some((c) => c.reviewSessionId === currentChat.reviewSessionId)
        if (!chatExists) {
          set({ currentChat: null, messages: [], toolCallsById: {} })
          return false
        }
        return true
      },

      selectChat: async (chat: CopilotChat) => {
        const { isSendingMessage, currentChat } = get()
        if (currentChat && currentChat.reviewSessionId !== chat.reviewSessionId && isSendingMessage) get().abortMessage()

        // Abort in-progress tools and clear diff when changing chats
        abortAllInProgressTools(set, get)

        // Capture previous chat/messages for optimistic background save after local aborts have settled.
        const previousChat = get().currentChat
        const previousMessages = get().messages
        const normalizedMessages = normalizeMessagesForUI(chat.messages || [], chat.latestTurnStatus)
        const optimisticToolCallsById = buildPinnedToolCallsById(normalizedMessages, {
          channelId: storeChannelId,
          workspaceId: chat.workspaceId,
        })

        // Optimistically set selected chat and normalize messages for UI
        set({
          currentChat: chat,
          messages: normalizedMessages,
          toolCallsById: optimisticToolCallsById,
          planTodos: [],
          showPlanTodos: false,
          suppressAutoSelect: false,
          contextUsage: null,
          isSendingMessage: isChatTurnInProgress(chat),
          abortController: null,
        })

        // Background-save the previous chat's latest messages before switching (optimistic)
        try {
          if (previousChat && previousChat.reviewSessionId !== chat.reviewSessionId) {
            const dbMessages = validateMessagesForLLM(previousMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reviewSessionId: previousChat.reviewSessionId,
                messages: dbMessages,
                latestTurnStatus: previousChat.latestTurnStatus ?? COMPLETED_TURN_STATUS,
              }),
            }).catch(() => {})
          }
        } catch {}

        // Refresh selected chat from server to ensure we have latest messages/tool calls
        try {
          const reviewSessionId = chat.reviewSessionId
          const response = await fetch(
            `/api/copilot/chat?reviewSessionId=${encodeURIComponent(reviewSessionId)}`
          )
          if (!response.ok) throw new Error(`Failed to fetch latest chat data: ${response.status}`)
          const data = await response.json()
          if (data.success && Array.isArray(data.chats)) {
            const latestChat =
              data.chats.find((c: CopilotChat) => c.reviewSessionId === chat.reviewSessionId) ?? data.chats[0] ?? null
            if (latestChat) {
              const normalizedMessages = normalizeMessagesForUI(
                latestChat.messages || [],
                latestChat.latestTurnStatus
              )
              const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                channelId: storeChannelId,
                workspaceId: latestChat.workspaceId,
              })

              set({
                currentChat: latestChat,
                messages: normalizedMessages,
                chats: (get().chats || []).map((c: CopilotChat) =>
                  c.reviewSessionId === chat.reviewSessionId ? latestChat : c
                ),
                contextUsage: null,
                toolCallsById,
                isSendingMessage: isChatTurnInProgress(latestChat),
                abortController: null,
              })
              logger.info('[Context Usage] Chat selected, fetching usage')
              await get().fetchContextUsage()
            }
          }
        } catch {}
      },

      createNewChat: async () => {
        const { isSendingMessage } = get()
        if (isSendingMessage) get().abortMessage()

        // Abort in-progress tools and clear diff on new chat
        abortAllInProgressTools(set, get)

        const currentChat = get().currentChat
        if (currentChat) {
          try {
            const currentMessages = get().messages
            const dbMessages = validateMessagesForLLM(currentMessages)
            fetch('/api/copilot/chat/update-messages', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                reviewSessionId: currentChat.reviewSessionId,
                messages: dbMessages,
                latestTurnStatus: currentChat.latestTurnStatus ?? COMPLETED_TURN_STATUS,
              }),
            }).catch(() => {})
          } catch {}
        }

        // Generic copilot keeps prior chats in panel history. "New chat" only clears
        // the active selection so the next send creates a fresh session for this panel.
        logger.info('[Context Usage] New chat created, clearing context usage')
        set(() => ({
          currentChat: null,
          messages: [],
          toolCallsById: {},
          planTodos: [],
          showPlanTodos: false,
          suppressAutoSelect: true,
          contextUsage: null,
        }))
      },

      deleteChat: async (reviewSessionId: string) => {
        try {
          // Call delete API
          const response = await fetch('/api/copilot/chat/delete', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reviewSessionId }),
          })

          if (!response.ok) {
            throw new Error(`Failed to delete chat: ${response.status}`)
          }

          // Remove from local state
          set((state) => ({
            chats: state.chats.filter((c) => c.reviewSessionId !== reviewSessionId),
            // If deleted chat was current, clear it
            currentChat: state.currentChat?.reviewSessionId === reviewSessionId ? null : state.currentChat,
            messages: state.currentChat?.reviewSessionId === reviewSessionId ? [] : state.messages,
            toolCallsById: state.currentChat?.reviewSessionId === reviewSessionId ? {} : state.toolCallsById,
          }))

          logger.info('Chat deleted', { reviewSessionId })
        } catch (error) {
          logger.error('Failed to delete chat:', error)
          throw error
        }
      },

      areChatsFresh: () => false,

      loadChats: async (_forceRefresh = false, options) => {
        const { liveContext, currentChat } = get()
        const resolvedWorkspaceId = options?.workspaceId ?? liveContext.workspaceId
        const channelScopeKey = buildPanelScopedGenericCopilotChatKey(
          storeChannelId,
          resolvedWorkspaceId
        )

        if (!channelScopeKey) {
          set({
            chats: currentChat ? [currentChat] : [],
            isLoadingChats: false,
            chatsLoadedForScope: null,
          })
          return
        }

        // For now always fetch fresh
        set({ isLoadingChats: true })
        try {
          const params = new URLSearchParams({ channelId: storeChannelId })
          if (resolvedWorkspaceId) {
            params.set('workspaceId', resolvedWorkspaceId)
          }
          const response = await fetch(`/api/copilot/chat?${params.toString()}`)
          if (!response.ok) {
            throw new Error(`Failed to fetch chats: ${response.status}`)
          }
          const data = await response.json()
          if (data.success && Array.isArray(data.chats)) {
            const now = new Date()
            set({
              chats: data.chats,
              isLoadingChats: false,
              chatsLastLoadedAt: now,
              chatsLoadedForScope: channelScopeKey,
            })

            if (data.chats.length > 0) {
              const { currentChat, isSendingMessage, suppressAutoSelect } = get()
              const currentChatStillExists =
                currentChat && data.chats.some((c: CopilotChat) => c.reviewSessionId === currentChat.reviewSessionId)

              if (currentChatStillExists) {
                const updatedCurrentChat = data.chats.find(
                  (c: CopilotChat) => c.reviewSessionId === currentChat!.reviewSessionId
                )!
                if (isSendingMessage) {
                  set({ currentChat: { ...updatedCurrentChat, messages: get().messages } })
                } else {
                  const normalizedMessages = normalizeMessagesForUI(
                    updatedCurrentChat.messages || [],
                    updatedCurrentChat.latestTurnStatus
                  )
                  const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                    channelId: storeChannelId,
                    workspaceId: updatedCurrentChat.workspaceId,
                  })

                  set({
                    currentChat: updatedCurrentChat,
                    messages: normalizedMessages,
                    toolCallsById,
                    isSendingMessage: isChatTurnInProgress(updatedCurrentChat),
                    abortController: null,
                  })
                }
              } else if (!isSendingMessage && !suppressAutoSelect) {
                const mostRecentChat: CopilotChat = data.chats[0]
                const normalizedMessages = normalizeMessagesForUI(
                  mostRecentChat.messages || [],
                  mostRecentChat.latestTurnStatus
                )
                const toolCallsById = buildPinnedToolCallsById(normalizedMessages, {
                  channelId: storeChannelId,
                  workspaceId: mostRecentChat.workspaceId,
                })

                set({
                  currentChat: mostRecentChat,
                  messages: normalizedMessages,
                  toolCallsById,
                  isSendingMessage: isChatTurnInProgress(mostRecentChat),
                  abortController: null,
                })
              }
            } else {
              set({
                currentChat: null,
                messages: [],
                toolCallsById: {},
                isSendingMessage: false,
                abortController: null,
              })
            }
          } else {
            throw new Error('Invalid response format')
          }
        } catch (error) {
          set({
            chats: [],
            isLoadingChats: false,
            error: error instanceof Error ? error.message : 'Failed to load chats',
          })
        }
      },

      // Send a message (streaming only)
      sendMessage: async (message: string, options = {}) => {
        const { liveContext, currentChat, revertState, implicitContexts } = get()
        const {
          stream = true,
          fileAttachments,
          contexts,
          messageId,
        } = options as {
          stream?: boolean
          fileAttachments?: MessageFileAttachment[]
          contexts?: ChatContext[]
          messageId?: string
        }

        // Generic copilot chat persistence is panel-scoped. The user's currently viewed
        // workflow/entity is attached here as live per-turn context instead of changing
        // the underlying chat thread when the panel view changes.
        const resolvedContexts = mergeCopilotContexts({
          explicitContexts: contexts,
          implicitContexts,
        })
        const turnProvenance = buildTurnProvenanceFromContexts(
          storeChannelId,
          resolvedContexts,
          liveContext.workspaceId
        )
        const contextsToSend = resolvedContexts.length > 0 ? resolvedContexts : undefined

        const abortController = new AbortController()
        set({ isSendingMessage: true, error: null, abortController })

        const userMessage = createUserMessage(message, fileAttachments, contextsToSend, messageId)
        const streamingMessage = createStreamingMessage()

        let newMessages: CopilotMessage[]
        if (revertState) {
          const currentMessages = get().messages
          newMessages = [...currentMessages, userMessage, streamingMessage]
          set({ revertState: null, inputValue: '' })
        } else {
          const currentMessages = get().messages
          // If messageId is provided, check if it already exists (e.g., from edit flow)
          const existingIndex = messageId
            ? currentMessages.findIndex((m) => m.id === messageId)
            : -1
          if (existingIndex !== -1) {
            // Replace existing message instead of adding new one
            newMessages = [
              ...currentMessages.slice(0, existingIndex),
              userMessage,
              streamingMessage,
            ]
          } else {
            // Add new messages normally
            newMessages = [...currentMessages, userMessage, streamingMessage]
          }
        }

        const isFirstMessage = get().messages.length === 0 && !currentChat?.title
        set((state) => ({
          messages: newMessages,
          currentUserMessageId: userMessage.id,
          ...buildChatTurnStatusState(state, ACTIVE_TURN_STATUS),
        }))

        if (currentChat?.reviewSessionId) {
          schedulePersistCurrentChatState(get, currentChat.reviewSessionId, ACTIVE_TURN_STATUS)
        }

        if (isFirstMessage) {
          const optimisticTitle = message.length > 50 ? `${message.substring(0, 47)}...` : message
          set((state) => ({
            currentChat: state.currentChat
              ? { ...state.currentChat, title: optimisticTitle }
              : state.currentChat,
          }))
        }

        try {
          const requestReviewSessionId = currentChat?.reviewSessionId
          const requestModel = get().selectedModel as CopilotStore['selectedModel']
          const requestProvider = resolveCopilotRuntimeProvider(requestModel)

          // Debug: log contexts presence before sending
          try {
            logger.info('sendMessage: preparing request', {
              hasContexts: Array.isArray(contextsToSend),
              contextsCount: Array.isArray(contextsToSend) ? contextsToSend.length : 0,
              contextsPreview: Array.isArray(contextsToSend)
                ? contextsToSend.map((c: any) => ({
                    kind: c?.kind,
                    reviewSessionId: (c as any)?.reviewSessionId,
                    workflowId: (c as any)?.workflowId,
                    label: (c as any)?.label,
                  }))
                : undefined,
            })
          } catch {}

          const result = await sendStreamingMessage({
            message,
            userMessageId: userMessage.id,
            reviewSessionId: requestReviewSessionId,
            channelId: storeChannelId,
            workspaceId: liveContext.workspaceId ?? undefined,
            model: requestModel,
            provider: requestProvider,
            prefetch: get().agentPrefetch,
            stream,
            fileAttachments,
            contexts: contextsToSend,
            abortSignal: abortController.signal,
          })

          if (result.success && result.stream) {
            await get().handleStreamingResponse(
              result.stream,
              streamingMessage.id,
              false,
              userMessage.id,
              turnProvenance
            )
            set({ chatsLastLoadedAt: null, chatsLoadedForScope: null })
          } else {
            if (result.error === 'Request was aborted') {
              return
            }

            // Check for specific status codes and provide custom messages
            let errorContent = result.error || 'Failed to send message'
            if (result.status === 401) {
              errorContent =
                '_Unauthorized request. You need a valid API key to use the copilot. You can get one by going to [TradingGoose.ai](https://tradinggoose.ai) settings and generating one there._'
            } else if (result.status === 402) {
              errorContent =
                '_Usage limit exceeded. To continue using this service, upgrade your plan or top up on credits._'
            } else if (result.status === 403) {
              errorContent =
                '_Provider config not allowed for non-enterprise users. Please remove the provider config and try again_'
            } else if (result.status === 426) {
              errorContent =
                '_Please upgrade to the latest version of the TradingGoose platform to continue using the copilot._'
            } else if (result.status === 429) {
              errorContent = '_Provider rate limit exceeded. Please try again later._'
            }

            const errorMessage = createErrorMessage(streamingMessage.id, errorContent)
            set((state) => ({
              messages: state.messages.map((m) =>
                m.id === streamingMessage.id ? errorMessage : m
              ),
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              error: errorContent,
              isSendingMessage: false,
              abortController: null,
            }))
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return
          const errorMessage = createErrorMessage(
            streamingMessage.id,
            'Sorry, I encountered an error while processing your message. Please try again.'
          )
          set((state) => ({
            messages: state.messages.map((m) => (m.id === streamingMessage.id ? errorMessage : m)),
            ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
            error: error instanceof Error ? error.message : 'Failed to send message',
            isSendingMessage: false,
            abortController: null,
          }))
        }
      },

      // Abort streaming
      abortMessage: () => {
        const { abortController, isSendingMessage, messages } = get()
        if (!isSendingMessage) return
        set({ isAborting: true })
        try {
          abortController?.abort()
          const lastMessage = messages[messages.length - 1]
          if (lastMessage && lastMessage.role === 'assistant') {
            const textContent =
              lastMessage.contentBlocks
                ?.filter((b) => b.type === 'text')
                .map((b: any) => b.content)
                .join('') || ''
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.id === lastMessage.id
                  ? { ...msg, content: textContent.trim() || 'Message was aborted' }
                  : msg
              ),
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            }))
          } else {
            set((state) => ({
              ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
              isSendingMessage: false,
              isAborting: false,
              abortController: null,
            }))
          }

          // Immediately put all in-progress tools into aborted state
          abortAllInProgressTools(set, get)

          const { currentChat } = get()
          if (currentChat) {
            void get().saveChatMessages(currentChat.reviewSessionId, {
              latestTurnStatus: COMPLETED_TURN_STATUS,
            })
          }

          // Fetch context usage after abort
          logger.info('[Context Usage] Message aborted, fetching usage')
          get()
            .fetchContextUsage()
            .catch((err) => {
              logger.warn('[Context Usage] Failed to fetch after abort', err)
            })
        } catch {
          set((state) => ({
            ...buildChatTurnStatusState(state, COMPLETED_TURN_STATUS),
            isSendingMessage: false,
            isAborting: false,
            abortController: null,
          }))
        }
      },

      // Tool-call related APIs are stubbed for now
      setToolCallState: (toolCall: any, newState: any) => {
        try {
          const id: string | undefined = toolCall?.id
          if (!id) return
          const map = { ...get().toolCallsById }
          const current = map[id]
          if (!current) return
          // Preserve rejected state from being overridden
          if (
            isRejectedState(current.state) &&
            (newState === 'success' || newState === ClientToolCallState.success)
          ) {
            return
          }
          let norm: ClientToolCallState = current.state
          if (newState === 'executing') norm = ClientToolCallState.executing
          else if (newState === 'errored' || newState === 'error') norm = ClientToolCallState.error
          else if (newState === 'rejected') norm = ClientToolCallState.rejected
          else if (newState === 'pending') norm = ClientToolCallState.pending
          else if (newState === 'success' || newState === 'accepted')
            norm = ClientToolCallState.success
          else if (newState === 'aborted') norm = ClientToolCallState.aborted
          else if (typeof newState === 'number') norm = newState as unknown as ClientToolCallState
          map[id] = {
            ...current,
            state: norm,
            display: resolveToolDisplay(current.name, norm, id, current.params),
          }
          set({ toolCallsById: map })
        } catch {}
      },
      updatePreviewToolCallState: (
        toolCallState: 'accepted' | 'rejected' | 'error',
        toolCallId?: string
      ) => {
        const stateMap: Record<string, ClientToolCallState> = {
          accepted: ClientToolCallState.success,
          rejected: ClientToolCallState.rejected,
          error: ClientToolCallState.error,
        }
        const targetState = stateMap[toolCallState] || ClientToolCallState.success
        const { toolCallsById } = get()
        // Determine target tool
        let id = toolCallId
        if (!id) {
          // Prefer the latest assistant message's build/edit tool_call
          const messages = get().messages
          outer: for (let mi = messages.length - 1; mi >= 0; mi--) {
            const m = messages[mi]
            if (m.role !== 'assistant' || !m.contentBlocks) continue
            const blocks = m.contentBlocks as any[]
            for (let bi = blocks.length - 1; bi >= 0; bi--) {
              const b = blocks[bi]
              if (b?.type === 'tool_call') {
                const tn = b.toolCall?.name
                if (tn === 'edit_workflow') {
                  id = b.toolCall?.id
                  break outer
                }
              }
            }
          }
          // Fallback to map if not found in messages
          if (!id) {
            const candidates = Object.values(toolCallsById).filter(
              (t) => t.name === 'edit_workflow'
            )
            id = candidates.length ? candidates[candidates.length - 1].id : undefined
          }
        }
        if (!id) return
        const current = toolCallsById[id]
        if (!current) return
        // Do not override a rejected tool with success
        if (
          isRejectedState(current.state) &&
          targetState === ClientToolCallState.success
        ) {
          return
        }

        // Update store map
        const updatedMap = { ...toolCallsById }
        const updatedDisplay = resolveToolDisplay(current.name, targetState, id, current.params)
        updatedMap[id] = {
          ...current,
          state: targetState,
          display: updatedDisplay,
        }
        set({ toolCallsById: updatedMap })

        // Update inline content block in the latest assistant message
        set((s) => {
          const messages = [...s.messages]
          for (let mi = messages.length - 1; mi >= 0; mi--) {
            const m = messages[mi]
            if (m.role !== 'assistant' || !m.contentBlocks) continue
            let changed = false
            const blocks = m.contentBlocks.map((b: any) => {
              if (b.type === 'tool_call' && b.toolCall?.id === id) {
                changed = true
                const prev = b.toolCall || {}
                return {
                  ...b,
                  toolCall: {
                    ...prev,
                    id,
                    name: current.name,
                    state: targetState,
                    display: updatedDisplay,
                    params: current.params,
                  },
                }
              }
              return b
            })
            if (changed) {
              messages[mi] = { ...m, contentBlocks: blocks }
              break
            }
          }
          return { messages }
        })

        // Notify backend mark-complete to finalize tool server-side
        try {
          postCopilotMarkComplete({
            toolCallId: id,
            toolName: current.name,
            status:
              targetState === ClientToolCallState.success
                ? 200
                : targetState === ClientToolCallState.rejected
                  ? 409
                  : 500,
            message: toolCallState,
          })
            .then(async (res) => {
              if (!res.ok) {
                let body: string | undefined
                try {
                  body = await res.text()
                } catch {}
                logger.warn('[mark-complete] proxy responded non-OK', {
                  toolCallId: id,
                  toolName: current.name,
                  status: res.status,
                  body: body?.slice(0, 200),
                })
              }
            })
            .catch((error) => {
              logger.warn('[mark-complete] proxy fetch failed', {
                toolCallId: id,
                toolName: current.name,
                error: error instanceof Error ? error.message : String(error),
              })
            })
        } catch {}
      },

      sendDocsMessage: async (query: string) => {
        await get().sendMessage(query)
      },

      saveChatMessages: async (chatId: string, options) => {
        const { currentChat, messages } = get()
        const targetChatId = chatId || currentChat?.reviewSessionId
        if (!targetChatId) return
        if (currentChat?.reviewSessionId && currentChat.reviewSessionId !== targetChatId) return

        try {
          const dbMessages = validateMessagesForLLM(messages)
          const latestTurnStatus =
            options?.latestTurnStatus ??
            currentChat?.latestTurnStatus ??
            (get().isSendingMessage ? ACTIVE_TURN_STATUS : COMPLETED_TURN_STATUS)
          await fetch('/api/copilot/chat/update-messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reviewSessionId: targetChatId,
              messages: dbMessages,
              latestTurnStatus,
            }),
          })
        } catch (error) {
          logger.warn('Failed to persist copilot chat messages', {
            chatId: targetChatId,
            latestTurnStatus: options?.latestTurnStatus,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },

      // Handle streaming response
      handleStreamingResponse: async (
        stream: ReadableStream,
        assistantMessageId: string,
        isContinuation = false,
        triggerUserMessageId?: string,
        turnProvenance?: CopilotToolExecutionProvenance
      ) => {
        const reader = stream.getReader()
        const decoder = new TextDecoder()

        const timeoutId = setTimeout(() => {
          logger.warn('Stream timeout reached, completing response')
          reader.cancel()
        }, 600000)

        try {
          const context: StreamingContext = {
            messageId: assistantMessageId,
            provenance: turnProvenance ?? { channelId: storeChannelId },
            contentBlocks: [],
            textBlocksByItemId: new Map(),
            thinkingBlocksByItemId: new Map(),
          }

          if (isContinuation) {
            const { messages } = get()
            const existingMessage = messages.find((m) => m.id === assistantMessageId)
            if (existingMessage) {
              context.contentBlocks = existingMessage.contentBlocks
                ? [...existingMessage.contentBlocks]
                : []
              hydrateStreamingBlockIndexes(context)
            }
          }

          for await (const data of parseSSEStream(reader, decoder)) {
            const { abortController } = get()
            if (abortController?.signal.aborted) break

            const handler = sseHandlers[data.type] || sseHandlers.default
            await handler(data, context, get, set)
            if (context.streamComplete) break
          }

          if (sseHandlers.stream_end) sseHandlers.stream_end({}, context, get, set)

          resetStreamingQueue()
          const finalContent = getStreamingAssistantContent(context)
          const latestTurnStatus = context.awaitingTools
            ? ACTIVE_TURN_STATUS
            : COMPLETED_TURN_STATUS
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === assistantMessageId
                ? {
                    ...msg,
                    content: finalContent,
                    contentBlocks: context.contentBlocks,
                  }
                : msg
            ),
            ...buildChatTurnStatusState(state, latestTurnStatus),
            isSendingMessage: context.awaitingTools === true,
            abortController: null,
            currentUserMessageId: null,
          }))

          if (context.newReviewSessionId && !get().currentChat) {
            await get().handleNewReviewSessionCreation(context.newReviewSessionId)
          }

          // Persist full message state (including contentBlocks) to database
          const { currentChat } = get()
          if (currentChat) {
            await get().saveChatMessages(currentChat.reviewSessionId, {
              latestTurnStatus,
            })
          }

          // Post copilot_stats record (input/output tokens can be null for now)
          try {
            // Removed: stats sending now occurs only on accept/reject with minimal payload
          } catch {}

          // Fetch context usage after response completes
          if (!context.awaitingTools) {
            logger.info('[Context Usage] Stream completed, fetching usage')
            const billingOptions = assistantMessageId
              ? {
                  bill: true,
                  assistantMessageId,
                  workflowId: context.provenance?.workflowId,
                }
              : undefined
            await get().fetchContextUsage(billingOptions)
          }
        } finally {
          clearTimeout(timeoutId)
        }
      },

      // Handle new chat creation from stream
      handleNewReviewSessionCreation: async (newReviewSessionId: string) => {
        const newChat: CopilotChat = {
          reviewSessionId: newReviewSessionId,
          workspaceId: get().liveContext.workspaceId,
          channelId: storeChannelId,
          entityKind: COPILOT_SESSION_KIND,
          entityId: null,
          draftSessionId: null,
          latestTurnStatus: ACTIVE_TURN_STATUS,
          title: null,
          messages: get().messages,
          messageCount: get().messages.length,
          conversationId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        // Abort any in-progress tools and clear diff on new chat creation
        abortAllInProgressTools(set, get)

        set({
          currentChat: newChat,
          chats: [newChat, ...(get().chats || [])],
          chatsLastLoadedAt: null,
          chatsLoadedForScope: null,
          planTodos: [],
          showPlanTodos: false,
          suppressAutoSelect: false,
        })

        schedulePersistCurrentChatState(get, newReviewSessionId, ACTIVE_TURN_STATUS)
      },

      // Utilities
      clearError: () => set({ error: null }),
      clearSaveError: () => set({ saveError: null }),
      retrySave: async (_chatId: string) => {},

      cleanup: () => {
        const { isSendingMessage } = get()
        if (isSendingMessage) get().abortMessage()
        resetStreamingQueue()
        // Clear any diff on cleanup
      },

      reset: () => {
        get().cleanup()
        // Abort in-progress tools prior to reset
        abortAllInProgressTools(set, get)
        set({ ...initialState, accessLevel: get().accessLevel })
      },

      // Input controls
      setInputValue: (value: string) => set({ inputValue: value }),
      clearRevertState: () => set({ revertState: null }),

      // Todo list (UI only)
      setPlanTodos: (todos) => set({ planTodos: todos, showPlanTodos: true }),
      updatePlanTodoStatus: (id, status) => {
        set((state) => {
          const updated = state.planTodos.map((t) =>
            t.id === id
              ? { ...t, completed: status === 'completed', executing: status === 'executing' }
              : t
          )
          return { planTodos: updated }
        })
      },
      closePlanTodos: () => set({ showPlanTodos: false }),

      // Diff updates are out of scope for minimal store
      updateDiffStore: async (_yamlContent: string) => {},
      updateDiffStoreWithWorkflowState: async (_workflowState: any) => {},

      setSelectedModel: async (model) => {
        logger.info('[Context Usage] Model changed', { from: get().selectedModel, to: model })
        set({ selectedModel: model })
        // Fetch context usage after model switch
        await get().fetchContextUsage()
      },
      setAgentPrefetch: (prefetch) => set({ agentPrefetch: prefetch }),

      // Fetch context usage from copilot API
      fetchContextUsage: async (
        options?: { bill?: boolean; assistantMessageId?: string; workflowId?: string }
      ) => {
        try {
          const { bill = false, assistantMessageId, workflowId } = options ?? {}
          const { currentChat, selectedModel, liveContext } = get()
          const activeWorkflowId = workflowId ?? (bill ? undefined : liveContext.workflowId)
          const selectedProvider = resolveCopilotRuntimeProvider(selectedModel)
          logger.info('[Context Usage] Starting fetch', {
            hasConversationId: !!currentChat?.conversationId,
            hasWorkflowId: !!activeWorkflowId,
            conversationId: currentChat?.conversationId,
            workflowId: activeWorkflowId,
            model: selectedModel,
            provider: selectedProvider,
            bill,
            assistantMessageId,
          })

          if (!currentChat) {
            set({ contextUsage: null })
            logger.info('[Context Usage] Skipping: missing current chat')
            return
          }

          if (!currentChat.conversationId) {
            set({ contextUsage: null })
            logger.info('[Context Usage] Skipping: missing conversationId', {
              hasConversationId: !!currentChat?.conversationId,
            })
            return
          }

          const requestPayload: Record<string, any> = {
            kind: 'context',
            conversationId: currentChat.conversationId,
            model: selectedModel,
            provider: selectedProvider,
            // Context usage is conversation-scoped. Forward the current workflow
            // only as supplemental runtime context when one exists.
            ...(activeWorkflowId ? { workflowId: activeWorkflowId } : {}),
          }
          if (bill && assistantMessageId) {
            requestPayload.bill = true
            requestPayload.assistantMessageId = assistantMessageId
            requestPayload.billingModel = selectedModel
          }

          logger.info('[Context Usage] Calling API', requestPayload)

          // Call the backend API route which proxies to copilot
          const response = await fetch('/api/copilot/usage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestPayload),
          })

          logger.info('[Context Usage] API response', { status: response.status, ok: response.ok })

          if (response.ok) {
            const data = await response.json()
            logger.info('[Context Usage] Received data', data)

            // Check for either tokensUsed or usage field
            if (
              data.tokensUsed !== undefined ||
              data.usage !== undefined ||
              data.percentage !== undefined
            ) {
              const contextUsage = {
                usage: data.tokensUsed || data.usage || 0,
                percentage: data.percentage || 0,
                model: data.model || selectedModel,
                contextWindow: data.contextWindow || data.context_window || 0,
                when: data.when || 'end',
                estimatedTokens: data.tokensUsed || data.estimated_tokens || data.estimatedTokens,
              }
              set({ contextUsage })
              logger.info('[Context Usage] Updated store', contextUsage)
            } else {
              logger.warn('[Context Usage] No usage data in response', data)
            }
          } else {
            const errorText = await response.text().catch(() => 'Unable to read error')
            logger.warn('[Context Usage] API call failed', {
              status: response.status,
              error: errorText,
            })
          }
        } catch (err) {
          logger.error('[Context Usage] Error fetching:', err)
        }
      },

      executeCopilotToolCall: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        const provenance = toolCall?.provenance
        if (!toolCall || !provenance) return

        const { id, name, params } = toolCall
        const executionContext = createExecutionContext({
          toolCallId: id,
          toolName: name,
          provenance: { ...provenance, channelId: provenance.channelId || DEFAULT_COPILOT_CHANNEL_ID },
        })
        const preparedArgs = prepareCopilotToolArgs(name, params, executionContext)

        const executingMap = { ...get().toolCallsById }
        executingMap[id] = {
          ...executingMap[id],
          state: ClientToolCallState.executing,
          display: resolveToolDisplay(name, ClientToolCallState.executing, id, params),
        }
        set({ toolCallsById: executingMap })
        logger.info('[toolCallsById] pending → executing (copilot tool)', { id, name })

        if (isServerManagedCopilotTool(name)) {
          try {
            const result = await executeCopilotServerTool({
              toolName: name,
              payload: preparedArgs,
            })
            const logicalSuccess =
              !result ||
              typeof result !== 'object' ||
              !('success' in result) ||
              (result as any).success !== false

            const completeMap = { ...get().toolCallsById }
            if (
              isRejectedState(completeMap[id]?.state) ||
              isReviewState(completeMap[id]?.state) ||
              isBackgroundState(completeMap[id]?.state)
            ) {
              return
            }

            completeMap[id] = {
              ...completeMap[id],
              state: logicalSuccess ? ClientToolCallState.success : ClientToolCallState.error,
              display: resolveToolDisplay(
                name,
                logicalSuccess ? ClientToolCallState.success : ClientToolCallState.error,
                id,
                params
              ),
            }
            set({ toolCallsById: completeMap })

            if (logicalSuccess && name === 'set_environment_variables') {
              try {
                await useEnvironmentStore.getState().loadEnvironmentVariables()
              } catch (error) {
                logger.warn('Failed to refresh environment store after setting variables', {
                  error,
                })
              }
            }

            const completionMessage =
              typeof (result as any)?.message === 'string'
                ? (result as any).message
                : resolveToolDisplay(
                    name,
                    logicalSuccess ? ClientToolCallState.success : ClientToolCallState.error,
                    id,
                    params
                  )?.text

            try {
              await postCopilotMarkComplete({
                toolCallId: id,
                toolName: name || 'unknown_tool',
                status: logicalSuccess ? 200 : 500,
                message: completionMessage,
                data: result,
              })
            } catch {}
            return
          } catch (error) {
            const errorMap = { ...get().toolCallsById }
            if (
              isRejectedState(errorMap[id]?.state) ||
              isReviewState(errorMap[id]?.state) ||
              isBackgroundState(errorMap[id]?.state)
            ) {
              return
            }

            const message = error instanceof Error ? error.message : String(error)
            errorMap[id] = {
              ...errorMap[id],
              state: ClientToolCallState.error,
              display: resolveToolDisplay(name, ClientToolCallState.error, id, params),
            }
            set({ toolCallsById: errorMap })

            try {
              await postCopilotMarkComplete({
                toolCallId: id,
                toolName: name || 'unknown_tool',
                status: getCopilotServerToolErrorStatus(error) ?? 500,
                message,
              })
            } catch {}
            logger.error('Copilot server tool execution failed', { id, name, error })
            return
          }
        }

        const instance = ensureClientToolInstance(name, id) as any
        if (!instance) {
          const errorMap = { ...get().toolCallsById }
          errorMap[id] = {
            ...errorMap[id],
            state: ClientToolCallState.error,
            display: resolveToolDisplay(name, ClientToolCallState.error, id, params),
          }
          set({ toolCallsById: errorMap })
          await reportClientManagedToolFailure({
            id,
            name,
            message: 'Client-managed copilot tool instance not found',
          })
          logger.error('Client-managed copilot tool instance not found', { id, name })
          return
        }

        try {
          if (typeof instance.hydratePersistedToolCall === 'function') {
            instance.hydratePersistedToolCall(toolCallsById[id])
          }
          bindClientToolExecutionContext(id, executionContext)
          if (typeof instance.handleUserAction === 'function') {
            await instance.handleUserAction(preparedArgs)
          } else if (
            instance.getInterruptDisplays?.() &&
            typeof instance.handleAccept === 'function'
          ) {
            await instance.handleAccept(preparedArgs)
          } else {
            await instance.execute(preparedArgs)
          }
        } catch (error) {
          const errorMap = { ...get().toolCallsById }
          if (
            isRejectedState(errorMap[id]?.state) ||
            isReviewState(errorMap[id]?.state) ||
            isBackgroundState(errorMap[id]?.state)
          ) {
            return
          }
          const message = error instanceof Error ? error.message : String(error)
          errorMap[id] = {
            ...errorMap[id],
            state: ClientToolCallState.error,
            display: resolveToolDisplay(name, ClientToolCallState.error, id, params),
          }
          set({ toolCallsById: errorMap })
          await reportClientManagedToolFailure({
            id,
            name,
            message,
            instance,
          })
          logger.error('Client-managed copilot tool execution failed', { id, name, error })
        }
      },

      skipCopilotToolCall: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        if (!toolCall) return

        const { id, name, params } = toolCall

        if (isServerManagedCopilotTool(name)) {
          const rejectedMap = { ...get().toolCallsById }
          rejectedMap[id] = {
            ...rejectedMap[id],
            state: ClientToolCallState.rejected,
            display: resolveToolDisplay(name, ClientToolCallState.rejected, id, params),
          }
          set({ toolCallsById: rejectedMap })

          postCopilotMarkComplete({
            toolCallId: id,
            toolName: name || 'unknown_tool',
            status: 200,
            message: 'Tool execution was skipped by the user',
            data: { skipped: true },
          }).catch(() => {})
          return
        }

        const instance = ensureClientToolInstance(name, id) as any
        if (instance?.handleReject) {
          await instance.handleReject()
          return
        }

        const rejectedMap = { ...get().toolCallsById }
        rejectedMap[id] = {
          ...rejectedMap[id],
          state: ClientToolCallState.rejected,
          display: resolveToolDisplay(name, ClientToolCallState.rejected, id, params),
        }
        set({ toolCallsById: rejectedMap })
      },

      executeIntegrationTool: async (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        const workflowId = toolCall?.provenance?.workflowId
        if (!toolCall || !workflowId) return

        const { id, name, params } = toolCall

        const executingMap = { ...get().toolCallsById }
        executingMap[id] = {
          ...executingMap[id],
          state: ClientToolCallState.executing,
          display: resolveToolDisplay(name, ClientToolCallState.executing, id, params),
        }
        set({ toolCallsById: executingMap })
        logger.info('[toolCallsById] pending → executing (integration tool)', { id, name })

        try {
          const res = await fetch('/api/copilot/execute-tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              toolCallId: id,
              toolName: name,
              arguments: params || {},
              workflowId,
            }),
          })

          let result: any = null
          try {
            result = await res.json()
          } catch {}

          const success =
            res.ok && result?.success && result?.result && result.result.success === true
          const completeMap = { ...get().toolCallsById }

          if (
            isRejectedState(completeMap[id]?.state) ||
            isReviewState(completeMap[id]?.state) ||
            isBackgroundState(completeMap[id]?.state)
          ) {
            return
          }

          completeMap[id] = {
            ...completeMap[id],
            state: success ? ClientToolCallState.success : ClientToolCallState.error,
            display: resolveToolDisplay(
              name,
              success ? ClientToolCallState.success : ClientToolCallState.error,
              id,
              params
            ),
          }
          set({ toolCallsById: completeMap })
          logger.info(
            `[toolCallsById] executing → ${success ? 'success' : 'error'} (integration)`,
            { id, name }
          )

          try {
            await postCopilotMarkComplete({
              toolCallId: id,
              toolName: name || 'unknown_tool',
              status: success ? 200 : 500,
              message: success
                ? result?.result?.output?.content
                : result?.result?.error || result?.error || 'Tool execution failed',
              data: success
                ? result?.result?.output
                : {
                    error: result?.result?.error || result?.error,
                    output: result?.result?.output,
                  },
            })
          } catch {}
        } catch (error) {
          const errorMap = { ...get().toolCallsById }
          if (
            isRejectedState(errorMap[id]?.state) ||
            isReviewState(errorMap[id]?.state) ||
            isBackgroundState(errorMap[id]?.state)
          ) {
            return
          }
          errorMap[id] = {
            ...errorMap[id],
            state: ClientToolCallState.error,
            display: resolveToolDisplay(name, ClientToolCallState.error, id, params),
          }
          set({ toolCallsById: errorMap })
          logger.error('Integration tool execution failed', { id, name, error })
        }
      },

      skipIntegrationTool: (toolCallId: string) => {
        const { toolCallsById } = get()
        const toolCall = toolCallsById[toolCallId]
        if (!toolCall) return

        const { id, name, params } = toolCall

        const rejectedMap = { ...get().toolCallsById }
        rejectedMap[id] = {
          ...rejectedMap[id],
          state: ClientToolCallState.rejected,
          display: resolveToolDisplay(name, ClientToolCallState.rejected, id, params),
        }
        set({ toolCallsById: rejectedMap })
        logger.info('[toolCallsById] pending → rejected (integration tool skipped)', { id, name })

        postCopilotMarkComplete({
          toolCallId: id,
          toolName: name || 'unknown_tool',
          status: 200,
          message: 'Tool execution skipped by user',
          data: { skipped: true },
        }).catch(() => {})
      },
    }))
  )

export const DEFAULT_COPILOT_CHANNEL_ID = 'default'

const copilotStoreRegistry = new Map<string, StoreApi<CopilotStore>>()
const defaultCopilotStore = createCopilotStoreInstance(DEFAULT_COPILOT_CHANNEL_ID)
copilotStoreRegistry.set(DEFAULT_COPILOT_CHANNEL_ID, defaultCopilotStore)

export const getCopilotStore = (channelId = DEFAULT_COPILOT_CHANNEL_ID) => {
  if (!copilotStoreRegistry.has(channelId)) {
    copilotStoreRegistry.set(channelId, createCopilotStoreInstance(channelId))
  }

  return copilotStoreRegistry.get(channelId)!
}

const findStoreForToolCall = (toolCallId: string) => {
  let fallbackStore: StoreApi<CopilotStore> | undefined
  for (const [channelId, store] of copilotStoreRegistry.entries()) {
    const toolCall = store.getState().toolCallsById[toolCallId]
    if (!toolCall) continue
    if (toolCall.provenance?.channelId === channelId) {
      return store
    }
    if (!fallbackStore) {
      fallbackStore = store
    }
  }
  return fallbackStore
}

registerCopilotStoreForToolCallResolver(
  (toolCallId) => findStoreForToolCall(toolCallId) ?? defaultCopilotStore
)

registerCopilotMarkCompleteContinuationHandler(async ({ toolCallId, response }) => {
  const targetStore = getCopilotStoreForToolCall(toolCallId)
  const turnProvenance = targetStore.getState().toolCallsById[toolCallId]?.provenance
  const assistantMessageId = findAssistantMessageIdForToolCall(
    targetStore.getState().messages,
    toolCallId
  )

  if (!assistantMessageId || !response.body) {
    logger.warn('Skipping copilot continuation stream; assistant message not found', {
      toolCallId,
      hasBody: !!response.body,
    })
    return
  }

  await targetStore.getState().handleStreamingResponse(
    response.body,
    assistantMessageId,
    true,
    undefined,
    turnProvenance
  )
})

const CopilotStoreContext = createContext<StoreApi<CopilotStore> | null>(null)

export function CopilotStoreProvider({
  channelId = DEFAULT_COPILOT_CHANNEL_ID,
  children,
}: {
  channelId?: string
  children: ReactNode
}) {
  const store = useMemo(() => getCopilotStore(channelId), [channelId])

  return createElement(CopilotStoreContext.Provider, { value: store }, children)
}

const identitySelector = (state: CopilotStore) => state

export function useCopilotStore<T = CopilotStore>(
  selector?: (state: CopilotStore) => T,
  equalityFn?: (a: T, b: T) => boolean
) {
  const store = useContext(CopilotStoreContext) ?? defaultCopilotStore
  const resolvedSelector = selector ?? (identitySelector as unknown as (state: CopilotStore) => T)
  return useStore(store, resolvedSelector, equalityFn)
}

export function useCopilotStoreApi(channelId?: string) {
  const storeFromContext = useContext(CopilotStoreContext)
  if (!channelId && storeFromContext) {
    return storeFromContext
  }
  return getCopilotStore(channelId)
}

// Sync class-based tool instance state changes back into the store map
try {
  registerToolStateSync((toolCallId: string, nextState: any, options?: { result?: any }) => {
    const targetStore = findStoreForToolCall(toolCallId) ?? defaultCopilotStore
    const state = targetStore.getState()
    const current = state.toolCallsById[toolCallId]
    if (!current) return
    let mapped: ClientToolCallState = current.state
    if (nextState === 'executing') mapped = ClientToolCallState.executing
    else if (nextState === 'pending') mapped = ClientToolCallState.pending
    else if (nextState === 'success' || nextState === 'accepted')
      mapped = ClientToolCallState.success
    else if (nextState === 'error' || nextState === 'errored') mapped = ClientToolCallState.error
    else if (nextState === 'rejected') mapped = ClientToolCallState.rejected
    else if (nextState === 'aborted') mapped = ClientToolCallState.aborted
    else if (nextState === 'review') mapped = ClientToolCallState.review
    else if (nextState === 'background') mapped = ClientToolCallState.background
    else if (typeof nextState === 'number') mapped = nextState as unknown as ClientToolCallState

    // Store-authoritative gating: ignore invalid/downgrade transitions
    const isTerminal = (s: ClientToolCallState) =>
      s === ClientToolCallState.success ||
      s === ClientToolCallState.error ||
      s === ClientToolCallState.rejected ||
      s === ClientToolCallState.aborted ||
      s === ClientToolCallState.review ||
      s === ClientToolCallState.background

    // If we've already reached a terminal state, ignore any further non-terminal updates
    if (isTerminal(current.state) && !isTerminal(mapped)) {
      return
    }
    // Prevent downgrades (executing → pending, pending → generating)
    if (
      (current.state === ClientToolCallState.executing && mapped === ClientToolCallState.pending) ||
      (current.state === ClientToolCallState.pending &&
        mapped === ClientToolCallState.generating)
    ) {
      return
    }
    const hasResultUpdate = options?.result !== undefined
    // No-op if unchanged and there is no staged-result update to persist
    if (mapped === current.state && !hasResultUpdate) return
    const updated = {
      ...state.toolCallsById,
      [toolCallId]: {
        ...current,
        state: mapped,
        display: resolveToolDisplay(current.name, mapped, toolCallId, current.params),
        ...(options?.result !== undefined ? { result: options.result } : {}),
      },
    }
    const updatedMessages = updateMessagesForToolCallState(
      state.messages,
      toolCallId,
      mapped,
      options
    )
    const latestTurnStatus = resolveTurnStatusFromToolCalls(updated)
    const nextChatState = buildChatTurnStatusState(state, latestTurnStatus)
    const nextCurrentChat = nextChatState.currentChat
      ? {
          ...nextChatState.currentChat,
          messages: updatedMessages,
        }
      : nextChatState.currentChat
    targetStore.setState({
      toolCallsById: updated,
      messages: updatedMessages,
      chats: nextChatState.chats,
      ...(nextCurrentChat ? { currentChat: nextCurrentChat } : {}),
    })

    // Only persist on terminal/meaningful state transitions to avoid redundant DB writes.
    // Intermediate states (generating, pending, executing) carry no new persisted data.
    const shouldPersist =
      mapped === ClientToolCallState.success ||
      mapped === ClientToolCallState.error ||
      mapped === ClientToolCallState.aborted ||
      mapped === ClientToolCallState.rejected ||
      mapped === ClientToolCallState.review ||
      mapped === ClientToolCallState.background

    if (shouldPersist) {
      const currentChat = targetStore.getState().currentChat
      if (currentChat?.reviewSessionId) {
        void targetStore.getState().saveChatMessages(currentChat.reviewSessionId, {
          latestTurnStatus,
        })
      }
    }
  })
} catch {}
