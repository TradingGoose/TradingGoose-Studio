'use client'

import { ensureClientToolInstance, resolveToolDisplay } from '@/stores/copilot/tool-registry'
import {
  buildTurnProvenanceFromContexts,
  withPinnedToolExecutionProvenance,
} from '@/stores/copilot/store-provenance'
import { normalizeReloadedToolState } from '@/stores/copilot/store-state'
import type {
  ChatContext,
  CopilotMessage,
  CopilotStore,
  CopilotToolCall,
  CopilotToolExecutionProvenance,
  MessageFileAttachment,
} from '@/stores/copilot/types'

export function normalizeMessagesForUI(
  messages: CopilotMessage[],
  latestTurnStatus?: string | null,
  accessLevel?: CopilotStore['accessLevel']
): CopilotMessage[] {
  try {
    return messages.map((message) => {
      if (message.role !== 'assistant') {
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

      const blocks: any[] = Array.isArray(message.contentBlocks)
        ? (message.contentBlocks as any[]).map((b: any) => {
            if (b?.type === 'tool_call' && b.toolCall) {
              const normalizedToolCall = {
                ...b.toolCall,
                state: normalizeReloadedToolState(
                  b.toolCall?.name,
                  b.toolCall?.state,
                  latestTurnStatus,
                  accessLevel
                ),
              }

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

      const updatedToolCalls = Array.isArray((message as any).toolCalls)
        ? (message as any).toolCalls.map((tc: any) => {
            const normalizedToolCall = {
              ...tc,
              state: normalizeReloadedToolState(
                tc?.name,
                tc?.state,
                latestTurnStatus,
                accessLevel
              ),
            }

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

export function buildPinnedToolCallsById(
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

    toolCallsById[toolCall.id] = withPinnedToolExecutionProvenance(toolCall, turnProvenance ?? {
      channelId: opts.channelId,
    })
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

export function updateMessagesForToolCallState(
  messages: CopilotMessage[],
  toolCallId: string,
  nextState: any,
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

export function createUserMessage(
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

export function createStreamingMessage(): CopilotMessage {
  return {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
  }
}

export function createErrorMessage(messageId: string, content: string): CopilotMessage {
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

export function validateMessagesForLLM(messages: CopilotMessage[]): any[] {
  return messages
    .map((msg) => {
      let content = msg.content || ''
      if (msg.role === 'assistant' && !content.trim() && msg.contentBlocks?.length) {
        content = msg.contentBlocks
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => String(b.content || ''))
          .join('')
          .trim()
      }

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
