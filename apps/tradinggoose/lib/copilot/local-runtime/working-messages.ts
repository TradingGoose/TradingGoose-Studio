/**
 * Working-message helpers for the local Copilot runtime.
 *
 * The managed Copilot service keeps the model conversation server-side. The
 * local runtime has no such service, so the OpenAI-style working history is
 * persisted by us (see `persistence.ts`) and rebuilt for every turn and tool
 * continuation.
 */

export interface LocalWorkingMessage {
  role: string
  content?: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export interface LocalContinuationInput {
  toolCallId: string
  toolName: string
  status: number
  message?: unknown
  data?: unknown
}

export interface LocalWorkingState {
  /** Working messages in truncation order (system message excluded then re-added). */
  messages: LocalWorkingMessage[]
  /** System prompt that produced this history. */
  systemPrompt: string
  /** Model context window in tokens, used for trimming. */
  contextWindow: number
}

export const DEFAULT_LOCAL_CONTEXT_WINDOW = 32_768
/** Rough characters-per-token ratio used to estimate prompt size. */
const CHARS_PER_TOKEN = 4

function isToolMessage(message: LocalWorkingMessage): boolean {
  return typeof message.tool_call_id === 'string' && message.tool_call_id.length > 0
}

/**
 * Builds the working message list for a turn.
 *
 * The system prompt is not stored in the list — it is prepended at request time
 * by `trimLocalWorkingMessages` — so prompt changes take effect immediately.
 */
export function buildLocalWorkingMessages(params: {
  systemPrompt: string
  priorWorkingMessages: LocalWorkingMessage[]
  userContent: string
  continuation?: LocalContinuationInput
  defaultContextWindow?: number
  contextWindow?: number
}): LocalWorkingMessage[] {
  const messages = [...(params.priorWorkingMessages ?? [])]

  if (params.continuation) {
    const { toolCallId, toolName, status, message, data } = params.continuation
    messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      name: toolName,
      content: truncate(
        JSON.stringify({
          ok: status >= 200 && status < 300,
          status,
          ...(message !== undefined ? { message } : {}),
          ...(data !== undefined ? { data } : {}),
        }),
        200_000
      ),
    })
    return trimLocalWorkingMessages(messages, {
      systemPrompt: params.systemPrompt,
      contextWindow: params.contextWindow ?? params.defaultContextWindow,
    })
  }

  messages.push({ role: 'user', content: params.userContent })
  return trimLocalWorkingMessages(messages, {
    systemPrompt: params.systemPrompt,
    contextWindow: params.contextWindow ?? params.defaultContextWindow,
  })
}

/**
 * Drops the oldest whole tool exchanges until the estimated prompt fits the
 * model context window, then prepends the system prompt.
 */
export function trimLocalWorkingMessages(
  messages: LocalWorkingMessage[],
  options: { systemPrompt: string; contextWindow?: number }
): LocalWorkingMessage[] {
  const contextWindow = options.contextWindow ?? DEFAULT_LOCAL_CONTEXT_WINDOW
  const systemMessage: LocalWorkingMessage = { role: 'system', content: options.systemPrompt }

  // Reserve room for the response, tools schema and context blocks.
  const budgetTokens = Math.max(2_048, Math.floor(contextWindow * 0.5))
  const budgetChars = budgetTokens * CHARS_PER_TOKEN

  const estimate = (list: LocalWorkingMessage[]) =>
    list.reduce((total, message) => total + JSON.stringify(message).length, 0)

  let trimmed = messages
  let index = 0
  while (estimate(trimmed) > budgetChars && index < trimmed.length - 2) {
    // Never split an assistant tool_calls message from its tool results: drop
    // forward until the next user/assistant message so the pairing survives.
    let end = index + 1
    while (end < trimmed.length && isToolMessage(trimmed[end])) end++
    trimmed = [...trimmed.slice(0, index), ...trimmed.slice(end)]
    // Keep the loop bounded if nothing was removable.
    if (isToolMessage(trimmed[index])) index++
  }

  return [systemMessage, ...trimmed]
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value
}
