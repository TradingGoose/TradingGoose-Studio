import type { LocalWorkingMessage } from '@/lib/copilot/local-runtime/working-messages'

export interface LocalSseEventSink {
  send(event: Record<string, unknown>): void
  close(): void
  error(err: unknown): void
}

export interface LocalRuntimeContext {
  userId: string
  accessLevel: 'limited' | 'full'
  contextEntityKind?: string
  contextEntityId?: string
  workspaceId?: string
  signal?: AbortSignal
}

export interface LocalAgentTurnParams {
  model: string
  /** Review-session id; also the key for the persisted working history. */
  conversationId: string
  /** User-facing message for this turn. */
  userMessage: string
  /** Context blocks already processed by processContextsServer. */
  contexts: Array<{ type: string; tag?: string; content: string }>
  fileContents?: Array<{ filename?: string; mediaType?: string; content?: string }>
  /** Working history loaded by the caller (null on a first turn). */
  priorWorkingMessages?: LocalWorkingMessage[] | null
  ctx: LocalRuntimeContext
  sink: LocalSseEventSink
  requestId: string
  /**
   * When resuming after a client-executed tool, the result to feed back to the
   * model so the loop can continue.
   */
  continuation?: {
    toolCallId: string
    toolName: string
    status: number
    message?: unknown
    data?: unknown
  }
}
