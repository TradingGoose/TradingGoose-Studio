import type { AgentExecutionOptions } from '@mastra/core/agent'
import type { ToolConfig } from '@/tools/types'

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
  providerOptions?: string | AgentExecutionOptions['providerOptions']
  apiKey?: string
}

export interface ToolInput {
  type?: string
  toolId?: string
  params?: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
  operation?: string
}

export interface AgentToolConfig {
  id: string
  definition?: ToolConfig
  mcp?: { serverId: string; toolName: string }
  name?: string
  description: string
  params?: Record<string, any>
  parameters: Record<string, any>
  usageControl?: 'auto' | 'force' | 'none'
}
