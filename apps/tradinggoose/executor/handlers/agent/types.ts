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
  maxSteps?: number | string
  apiKey?: string
  providerOptions?: string | Record<string, any>
}

export interface ToolInput {
  type?: string
  schema?: any
  title?: string
  toolId?: string
  params?: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
  operation?: string
}

export type Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string }

export interface AgentToolConfig {
  id: string
  mcp?: { serverId: string; toolName: string }
  name?: string
  description: string
  params?: Record<string, any>
  parameters: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
}
