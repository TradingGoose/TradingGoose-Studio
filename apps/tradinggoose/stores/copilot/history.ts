import type { MastraMessagePart } from '@mastra/core/agent/message-list'
import { ChatContextSchema } from '@/lib/copilot/chat-context-schema'
import { COPILOT_CONTEXT_PART, type Json } from '@/lib/copilot/native/contract'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { isServerToolReviewRejectedResult } from '@/lib/copilot/tools/shared/review-result'
import type { NativeHistoryMessage } from '@/lib/mastra/messages'
import type { CopilotMessage, CopilotToolCall } from './types'

const record = (value: unknown): value is Record<string, Json> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const invocationStates = new Set([
  'partial-call',
  'call',
  'result',
  'approval-requested',
  'approval-responded',
  'output-error',
  'output-denied',
])

/** Display only: native format2 parts never create an executable local tool or provider report. */
export function projectNativeHistoryMessage(message: NativeHistoryMessage): CopilotMessage | null {
  if (message.role === 'signal') return null
  const timestamp = new Date(message.createdAt).getTime()
  if (!Number.isFinite(timestamp) || !message.id || !Array.isArray(message.parts))
    throw new Error('Native history message identity/time is invalid')
  const blocks: NonNullable<CopilotMessage['contentBlocks']> = []
  let contexts: CopilotMessage['contexts']
  for (const part of message.parts) {
    if (part.type === 'text') {
      if (typeof part.text !== 'string') throw new Error('Native history text is invalid')
      const text: Extract<MastraMessagePart, { type: 'text' }> = { type: 'text', text: part.text }
      blocks.push({ type: 'text', content: text.text, timestamp })
    } else if (part.type === 'reasoning') {
      if (typeof part.reasoning !== 'string' || !Array.isArray(part.details))
        throw new Error('Native history reasoning is invalid')
      blocks.push({ type: 'thinking', content: part.reasoning, timestamp })
    } else if (part.type === 'tool-invocation') {
      const invocation = part.toolInvocation
      if (
        !record(invocation) ||
        typeof invocation.toolCallId !== 'string' ||
        !invocation.toolCallId ||
        typeof invocation.toolName !== 'string' ||
        typeof invocation.state !== 'string' ||
        !invocationStates.has(invocation.state)
      )
        throw new Error('Native history tool invocation is invalid')
      const call: CopilotToolCall = {
        id: invocation.toolCallId,
        name: invocation.toolName,
        historical: true,
        state:
          invocation.state === 'result'
            ? isServerToolReviewRejectedResult(invocation.toolName, invocation.result)
              ? ClientToolCallState.rejected
              : invocation.isError === true
                ? ClientToolCallState.error
                : ClientToolCallState.success
            : invocation.state === 'output-error'
              ? ClientToolCallState.error
              : invocation.state === 'output-denied'
                ? ClientToolCallState.rejected
                : ClientToolCallState.aborted,
        ...(record(invocation.args) ? { params: invocation.args } : {}),
        ...(invocation.result !== undefined ? { result: invocation.result } : {}),
      }
      blocks.push({ type: 'tool_call', toolCall: call, timestamp })
    } else if (part.type === 'file') {
      const match =
        typeof part.data === 'string'
          ? /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.data)
          : null
      if (
        typeof part.data !== 'string' ||
        !match ||
        part.mimeType !== match[1] ||
        match[2].length % 4 !== 0 ||
        !atob(match[2]).length
      )
        throw new Error(
          'Native history image must contain valid inline bytes and matching media type'
        )
      blocks.push({ type: 'file', file: { data: part.data, mimeType: match[1] }, timestamp })
    } else if (message.role === 'user' && part.type === COPILOT_CONTEXT_PART) {
      contexts = ChatContextSchema.array().parse(part.data)
    } else if (
      typeof part.type !== 'string' ||
      !(
        ['step-start', 'source', 'source-url', 'source-document', 'error'].includes(part.type) ||
        part.type.startsWith('data-')
      )
    ) {
      throw new Error('Unsupported native history part')
    }
    // Provider metadata, steps, raw errors and opaque data carriers are never public report fields.
  }
  return {
    id: message.id,
    role: message.role,
    timestamp: message.createdAt,
    content: blocks
      .filter((block) => block.type === 'text')
      .map((block) => block.content)
      .join(''),
    contentBlocks: blocks,
    ...(contexts?.length ? { contexts } : {}),
    ...(message.usage ? { usage: message.usage } : {}),
    ...(message.cost ? { cost: message.cost } : {}),
  }
}
export function projectNativeHistory(messages: NativeHistoryMessage[]): CopilotMessage[] {
  const seen = new Set<string>()
  return messages.flatMap((message) => {
    if (seen.has(message.id)) throw new Error('Native history message identity repeats')
    seen.add(message.id)
    const projected = projectNativeHistoryMessage(message)
    return projected ? [projected] : []
  })
}
