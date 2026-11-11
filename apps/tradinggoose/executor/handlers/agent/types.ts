export interface SkillInput {
  skillId: string
  name?: string
  description?: string
}

export interface AgentInputs {
  model?: string
  responseFormat?: string | object
  tools?: ToolInput[]
  skills?: SkillInput[]
  systemPrompt?: string | object
  userPrompt?: string | object
  memories?: any
  temperature?: number
  maxTokens?: number
  apiKey?: string
  reasoningEffort?: string
  providerOptions?: string | Record<string, any>
}

export interface ToolInput {
  type?: string
  schema?: any
  title?: string
  toolId?: string
  code?: string
  params?: Record<string, any>
  timeout?: number
  usageControl?: 'auto' | 'force' | 'none'
  operation?: string
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export interface AgentToolConfig {
  id: string
  name?: string
  description: string
  params?: Record<string, any>
  parameters: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
  executeFunction?: (params: Record<string, any>, signal?: AbortSignal) => Promise<any>
}
