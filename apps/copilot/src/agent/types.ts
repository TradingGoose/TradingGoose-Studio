export type AgentMode = 'ask' | 'agent'

export interface AgentContextItem {
  type: string
  content: string
  tag?: string
}

export interface AgentResponse {
  reply: string
  operations?: any[]
  reasoning?: string
  model: string
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, any> }>
  usage?: any
  tokenUsage?: any
  tokens?: any
}
