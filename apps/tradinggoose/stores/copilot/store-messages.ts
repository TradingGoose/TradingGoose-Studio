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

function parseJsonObjectPrefix(
  value: string
): { object: Record<string, unknown>; rest: string } | null {
  let inString = false
  let escaped = false
  let depth = 0
  const start = value.search(/\S/)
  if (start < 0 || value[start] !== '{') return null

  for (let index = start; index < value.length; index++) {
    const char = value[index]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }

    if (char === '{') {
      depth += 1
      continue
    }

    if (char !== '}') continue
    depth -= 1
    if (depth !== 0) continue

    try {
      const parsed = JSON.parse(value.slice(start, index + 1))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
      return {
        object: parsed as Record<string, unknown>,
        rest: value.slice(index + 1),
      }
    } catch {
      return null
    }
  }

  return null
}

function normalizeAssistantReasoningContent(content: string): {
  content: string
  reasoning?: string
} {
  const parsed = parseJsonObjectPrefix(content)
  if (!parsed || typeof parsed.object.reasoning !== 'string') {
    return { content }
  }

  const explicitContent =
    typeof parsed.object.reply === 'string'
      ? parsed.object.reply
      : typeof parsed.object.content === 'string'
        ? parsed.object.content
        : typeof parsed.object.message === 'string'
          ? parsed.object.message
          : typeof parsed.object.text === 'string'
            ? parsed.object.text
            : undefined

  return {
    content: (explicitContent ?? parsed.rest).trim(),
    reasoning: parsed.object.reasoning.trim(),
  }
}

function normalizeAssistantContentBlocks(blocks: any[]): any[] {
  return blocks.flatMap((block) => {
    if (block?.type !== 'text' || typeof block.content !== 'string') {
      return [block]
    }

    const normalized = normalizeAssistantReasoningContent(block.content)
    if (!normalized.reasoning) {
      return [block]
    }

    const timestamp = typeof block.timestamp === 'number' ? block.timestamp : Date.now()
    return [
      {
        type: 'thinking',
        content: normalized.reasoning,
        timestamp,
        ...(typeof block.itemId === 'string' ? { itemId: `${block.itemId}-reasoning` } : {}),
      },
      ...(normalized.content
        ? [
            {
              ...block,
              content: normalized.content,
            },
          ]
        : []),
    ]
  })
}

function getMessageBlockTimestamp(message: CopilotMessage): number {
  const timestamp = Date.parse(message.timestamp)
  return Number.isFinite(timestamp) ? timestamp : Date.now()
}

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

      const normalizedContent = normalizeAssistantReasoningContent(message.content || '')
      const messageBlockTimestamp = getMessageBlockTimestamp(message)
      const hydratedBlocks: any[] = Array.isArray(message.contentBlocks)
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
      const blocks = normalizeAssistantContentBlocks(hydratedBlocks)
      const reasoningBlock =
        normalizedContent.reasoning && !blocks.some((block: any) => block?.type === 'thinking')
          ? {
              type: 'thinking',
              content: normalizedContent.reasoning,
              timestamp: messageBlockTimestamp,
            }
          : null
      const finalBlocks = reasoningBlock && blocks.length > 0 ? [reasoningBlock, ...blocks] : blocks

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
        content: normalizedContent.content,
        ...(updatedToolCalls && { toolCalls: updatedToolCalls }),
        ...(finalBlocks.length > 0
          ? { contentBlocks: finalBlocks }
          : normalizedContent.reasoning || normalizedContent.content.trim()
            ? {
                contentBlocks: [
                  ...(reasoningBlock ? [reasoningBlock] : []),
                  ...(normalizedContent.content.trim()
                    ? [
                        {
                          type: 'text',
                          content: normalizedContent.content,
                          timestamp: messageBlockTimestamp,
                        },
                      ]
                    : []),
                ],
              }
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
    workspaceId?: string | null
  }
): Record<string, CopilotToolCall> {
  const toolCallsById: Record<string, CopilotToolCall> = {}
  let turnProvenance: CopilotToolExecutionProvenance | undefined
  const pinToolCall = (toolCall: CopilotToolCall | null | undefined) => {
    if (!toolCall?.id) {
      return
    }

    const baseProvenance =
      turnProvenance ?? (opts.workspaceId ? { workspaceId: opts.workspaceId } : undefined)

    toolCallsById[toolCall.id] = withPinnedToolExecutionProvenance(toolCall, baseProvenance)
  }

  for (const message of messages) {
    if (message.role === 'user') {
      turnProvenance = buildTurnProvenanceFromContexts(
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
