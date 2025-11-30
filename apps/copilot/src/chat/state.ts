import type { AiRouterProvider } from '../llm/ai-router'

type Role = 'user' | 'assistant' | 'system' | 'tool'

export interface SessionToolCall {
  id?: string
  name: string
  arguments?: Record<string, any>
}

export interface SessionMessage {
  role: Role
  content: string
  name?: string
  toolCalls?: SessionToolCall[]
  toolCallId?: string
}

export interface Session {
  chatId: string
  userId: string
  workflowId: string
  mode: 'ask' | 'agent'
  model?: string
  provider?: AiRouterProvider
  stream: {
    writeSSE: (arg: { data: string }) => Promise<void>
  }
  messages: SessionMessage[]
  toolCallIds: Set<string>
  pendingToolCallIds: Set<string>
  pendingReviewToolCallIds: Set<string>
  lastUserMessage: string
  closed: boolean
  resolve?: () => void
}

const sessions = new Map<string, Session>()
const toolCallToChat = new Map<string, string>()

export function createSession(session: Session) {
  sessions.set(session.chatId, session)
}

export function getSessionByChatId(chatId: string): Session | undefined {
  return sessions.get(chatId)
}

export function mapToolCall(toolCallId: string, chatId: string) {
  toolCallToChat.set(toolCallId, chatId)
}

export function getSessionByToolCallId(toolCallId: string): Session | undefined {
  const chatId = toolCallToChat.get(toolCallId)
  if (!chatId) return undefined
  return sessions.get(chatId)
}

export function closeSession(chatId: string) {
  sessions.delete(chatId)
  for (const [tcId, cId] of toolCallToChat.entries()) {
    if (cId === chatId) toolCallToChat.delete(tcId)
  }
}
