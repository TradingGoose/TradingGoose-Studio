import type { ProviderId } from '@/providers/ai/types'

/**
 * A tool call the model asked for. `arguments` stays a JSON string because that
 * is what both provider APIs emit and what the SSE `function_call` item carries.
 */
export interface LocalCopilotToolCall {
  id: string
  name: string
  arguments: string
}

export type LocalCopilotMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant'
      content: string
      reasoning?: string
      toolCalls?: LocalCopilotToolCall[]
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

export interface LocalCopilotContext {
  type: string
  tag?: string
  content: string
}

/**
 * Everything needed to resume a turn after the browser has run the pending tool
 * calls. The hosted service kept this server-side keyed by `conversationId`, and
 * the resume request (`/api/tools/mark-complete`) carries only a tool call id, so
 * the local runtime has to keep the same shape of state.
 */
export interface LocalCopilotConversation {
  id: string
  userId: string
  model: string
  provider: ProviderId
  userName?: string
  /**
   * The workspace the chat was opened against. Several tools take it as a
   * required argument and no tool can discover it, so the model only ever learns
   * it from the system prompt.
   */
  workspaceId?: string
  contexts: LocalCopilotContext[]
  messages: LocalCopilotMessage[]
  /** Tool calls the model emitted that the browser has not reported back yet. */
  pendingToolCalls: LocalCopilotToolCall[]
  updatedAt: number
}

/**
 * Persisted chat history, sent by the chat route so a turn can be reconstructed
 * when the cached conversation has expired or was never written.
 */
export interface LocalCopilotHistoryMessage {
  role: string
  content: string | null
}

export type LlmStreamDelta =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call_start'; index: number; id: string; name: string }
  | { type: 'tool_call_arguments'; index: number; delta: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
