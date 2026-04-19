import {
  shouldAutoExecuteCopilotTool,
  shouldAutoExecuteIntegrationTool,
} from '@/lib/copilot/access-policy'
import { normalizeFunctionCallArguments } from '@/lib/copilot/function-call-args'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { withPinnedToolExecutionProvenance } from '@/stores/copilot/store-provenance'
import { ACTIVE_TURN_STATUS } from '@/stores/copilot/store-state'
import {
  bindClientToolExecutionContext,
  copilotToolHasInterrupt,
  copilotToolSupportsState,
  createExecutionContext,
  ensureClientToolInstance,
  isBackgroundState,
  isCopilotTool,
  isRejectedState,
  isReviewState,
  resolveToolDisplay,
} from '@/stores/copilot/tool-registry'
import type {
  CopilotStore,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
} from '@/stores/copilot/types'

export interface StreamingContext {
  messageId: string
  provenance?: CopilotToolExecutionProvenance
  contentBlocks: any[]
  textBlocksByItemId: Map<string, any>
  thinkingBlocksByItemId: Map<string, any>
  pendingAutoExecutionToolCallIds?: Set<string>
  newReviewSessionId?: string
  awaitingTools?: boolean
  streamComplete?: boolean
}

export type SSEHandler = (
  data: any,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any
) => Promise<void> | void

type StreamingLogger = Pick<Console, 'info' | 'warn' | 'error'>

const streamingUpdateQueue = new Map<string, StreamingContext>()
let streamingUpdateRAF: number | null = null
const TEXT_BLOCK_TYPE = 'text'
const THINKING_BLOCK_TYPE = 'thinking'
const DATA_PREFIX = 'data: '
const DATA_PREFIX_LENGTH = 6

function createOptimizedContentBlocks(contentBlocks: any[]): any[] {
  const result: any[] = new Array(contentBlocks.length)
  for (let i = 0; i < contentBlocks.length; i++) {
    const block = contentBlocks[i]
    result[i] = { ...block }
  }
  return result
}

export function updateStreamingMessage(set: any, context: StreamingContext) {
  streamingUpdateQueue.set(context.messageId, context)
  if (streamingUpdateRAF !== null) {
    return
  }

  streamingUpdateRAF = requestAnimationFrame(() => {
    const updates = new Map(streamingUpdateQueue)
    streamingUpdateQueue.clear()
    streamingUpdateRAF = null
    set((state: CopilotStore) => {
      if (updates.size === 0) return state
      const messages = state.messages
      const lastMessage = messages[messages.length - 1]
      const lastMessageUpdate = lastMessage ? updates.get(lastMessage.id) : null
      if (updates.size === 1 && lastMessageUpdate) {
        const newMessages = [...messages]
        newMessages[messages.length - 1] = {
          ...lastMessage,
          content: '',
          contentBlocks:
            lastMessageUpdate.contentBlocks.length > 0
              ? createOptimizedContentBlocks(lastMessageUpdate.contentBlocks)
              : [],
        }
        return { messages: newMessages }
      }
      return {
        messages: messages.map((msg) => {
          const update = updates.get(msg.id)
          if (update) {
            return {
              ...msg,
              content: '',
              contentBlocks:
                update.contentBlocks.length > 0
                  ? createOptimizedContentBlocks(update.contentBlocks)
                  : [],
            }
          }
          return msg
        }),
      }
    })
  })
}

export function resetStreamingQueue() {
  if (streamingUpdateRAF !== null) {
    cancelAnimationFrame(streamingUpdateRAF)
    streamingUpdateRAF = null
  }
  streamingUpdateQueue.clear()
}

type StreamingBlock = NonNullable<CopilotStore['messages'][number]['contentBlocks']>[number] & {
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

export function hydrateStreamingBlockIndexes(context: StreamingContext) {
  for (const block of context.contentBlocks as StreamingBlock[]) {
    if (!block?.itemId) continue
    if (block.type === TEXT_BLOCK_TYPE) {
      context.textBlocksByItemId.set(block.itemId, block)
    } else if (block.type === THINKING_BLOCK_TYPE) {
      context.thinkingBlocksByItemId.set(block.itemId, block)
    }
  }
}

export function getStreamingAssistantContent(context: StreamingContext): string {
  return context.contentBlocks
    .filter((block: any) => block?.type === TEXT_BLOCK_TYPE)
    .map((block: any) => String(block.content || ''))
    .join('')
}

function applyStreamedFunctionCallItem(
  item: Record<string, unknown>,
  context: StreamingContext,
  get: () => CopilotStore,
  set: any,
  logger: StreamingLogger
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

  const executionContext = createExecutionContext({
    toolCallId: id,
    toolName: name,
    provenance: next.provenance ?? {},
  })

  try {
    bindClientToolExecutionContext(id, executionContext)
  } catch (error) {
    logger.warn('Failed to bind execution context', { id, name, error })
  }

  if (!context.pendingAutoExecutionToolCallIds) {
    context.pendingAutoExecutionToolCallIds = new Set()
  }
  context.pendingAutoExecutionToolCallIds.add(id)
}

function scheduleAutomaticToolExecution(
  toolCallId: string,
  toolName: string,
  get: () => CopilotStore,
  logger: StreamingLogger
) {
  if (isCopilotTool(toolName)) {
    try {
      const hasInterrupt = copilotToolHasInterrupt(toolName, toolCallId)
      const entersReviewState = copilotToolSupportsState(
        toolName,
        ClientToolCallState.review
      )
      const { accessLevel } = get()
      if (shouldAutoExecuteCopilotTool(accessLevel, hasInterrupt, entersReviewState)) {
        setTimeout(() => {
          void get().executeCopilotToolCall(toolCallId)
        }, 0)
      } else {
        logger.info('[copilot access] copilot tool awaiting confirmation', {
          accessLevel,
          id: toolCallId,
          name: toolName,
        })
      }
    } catch (error) {
      logger.warn('Copilot tool auto-exec check failed', {
        id: toolCallId,
        name: toolName,
        error,
      })
    }
    return
  }

  try {
    const { accessLevel } = get()
    if (shouldAutoExecuteIntegrationTool(accessLevel)) {
      logger.info('[copilot access] auto-executing integration tool', {
        accessLevel,
        id: toolCallId,
        name: toolName,
      })
      setTimeout(() => {
        void get().executeIntegrationTool(toolCallId)
      }, 0)
    } else {
      logger.info('[copilot access] integration tool awaiting confirmation', {
        accessLevel,
        id: toolCallId,
        name: toolName,
      })
    }
  } catch (error) {
    logger.warn('Integration tool access check failed', {
      id: toolCallId,
      name: toolName,
      error,
    })
  }
}

export async function flushPendingAutoExecutionToolCalls(
  context: StreamingContext,
  get: () => CopilotStore,
  logger: StreamingLogger
) {
  const pendingToolCallIds = context.pendingAutoExecutionToolCallIds
  if (!pendingToolCallIds || pendingToolCallIds.size === 0) {
    return
  }

  const pendingIds = [...pendingToolCallIds]
  pendingToolCallIds.clear()
  const toolCallsById = get().toolCallsById
  const { accessLevel } = get()
  for (const toolCallId of pendingIds) {
    const toolCall = toolCallsById[toolCallId]
    if (!toolCall || toolCall.state !== ClientToolCallState.pending) {
      continue
    }

    if (
      accessLevel !== 'full' &&
      isCopilotTool(toolCall.name) &&
      copilotToolSupportsState(toolCall.name, ClientToolCallState.review)
    ) {
      await get().executeCopilotToolCall(toolCallId)
      continue
    }

    scheduleAutomaticToolExecution(toolCallId, toolCall.name, get, logger)
  }
}

function buildStreamedToolDisplayState(
  toolCallId: string,
  targetState: ClientToolCallState,
  context: StreamingContext
) {
  for (let i = 0; i < context.contentBlocks.length; i++) {
    const block = context.contentBlocks[i] as any
    if (block?.type !== 'tool_call' || block?.toolCall?.id !== toolCallId) {
      continue
    }

    if (
      isRejectedState(block.toolCall?.state) ||
      isReviewState(block.toolCall?.state) ||
      isBackgroundState(block.toolCall?.state)
    ) {
      break
    }

    context.contentBlocks[i] = {
      ...block,
      toolCall: {
        ...block.toolCall,
        state: targetState,
        display: resolveToolDisplay(
          block.toolCall?.name,
          targetState,
          toolCallId,
          block.toolCall?.params
        ),
      },
    }
    break
  }
}

export function createSSEHandlers(params: {
  logger: StreamingLogger
  schedulePersistCurrentChatState: (
    get: () => CopilotStore,
    reviewSessionId: string,
    latestTurnStatus: string
  ) => void
}): Record<string, SSEHandler> {
  const { logger, schedulePersistCurrentChatState } = params

  return {
    review_session_id: async (data, context, get) => {
      context.newReviewSessionId = data.reviewSessionId
      const { currentChat } = get()
      if (!currentChat && context.newReviewSessionId) {
        await get().handleNewReviewSessionCreation(
          context.newReviewSessionId,
          context.provenance?.workspaceId ?? null
        )
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

        const targetState = success
          ? ClientToolCallState.success
          : failedDependency || skipped
            ? ClientToolCallState.rejected
            : ClientToolCallState.error

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

          set({
            toolCallsById: {
              ...toolCallsById,
              [toolCallId]: {
                ...current,
                state: targetState,
                display: resolveToolDisplay(
                  current.name,
                  targetState,
                  current.id,
                  (current as any).params
                ),
              },
            },
          })

          if (targetState === ClientToolCallState.success) {
            try {
              const result = data?.result || data?.data?.result || {}
              const input = (current as any).params || (current as any).input || {}
              const todoId = input.id || input.todoId || result.id || result.todoId
              if (todoId && current.name === 'checkoff_todo') {
                get().updatePlanTodoStatus(todoId, 'completed')
              } else if (todoId && current.name === 'mark_todo_in_progress') {
                get().updatePlanTodoStatus(todoId, 'executing')
              }
            } catch {}
          }
        }

        buildStreamedToolDisplayState(toolCallId, targetState, context)
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

        const targetState = failedDependency
          ? ClientToolCallState.rejected
          : ClientToolCallState.error

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

          set({
            toolCallsById: {
              ...toolCallsById,
              [toolCallId]: {
                ...current,
                state: targetState,
                display: resolveToolDisplay(
                  current.name,
                  targetState,
                  current.id,
                  (current as any).params
                ),
              },
            },
          })
        }

        buildStreamedToolDisplayState(toolCallId, targetState, context)
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
        applyStreamedFunctionCallItem(item as Record<string, unknown>, context, get, set, logger)
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
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  logger: StreamingLogger
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
