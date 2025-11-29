import { config } from '../config'
import { getAiRouterCompletion } from '../llm/ai-router'
import type { AiRouterProvider } from '../llm/ai-router'
import type { SessionMessage } from '../state'
import { buildMessages } from './messages'
import { buildToolsForAiRouter, toolsForMode } from './tooling'
import type { AgentContextItem, AgentMode, AgentResponse } from './types'

export type { AgentContextItem, AgentMode, AgentResponse } from './types'

export async function generateAgentResponse(options: {
  message: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  messages?: SessionMessage[]
  userName?: string
  model?: string
  mode: AgentMode
  provider?: AiRouterProvider
}): Promise<AgentResponse> {
  const allowedTools = toolsForMode(options.mode)
  const messages = buildMessages({
    userMessage: options.message,
    workflowSummary: options.workflowSummary,
    contexts: options.contexts,
    history: options.messages,
    userName: options.userName,
    allowedTools,
    mode: options.mode,
  })
  const tools = buildToolsForAiRouter(allowedTools)

  const completion = await getAiRouterCompletion({
    messages,
    tools,
    model: options.model,
    mode: options.mode,
    provider: options.provider,
  })

  return {
    reply: completion.content,
    operations: completion.operations,
    reasoning: completion.reasoning,
    toolCalls: completion.toolCalls,
    model: completion.model || options.model || config.defaultModel,
  }
}
