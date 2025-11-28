import { config, SYSTEM_PROMPT } from './config'
import { getGatewayCompletion } from './gateway'
import { COPILOT_TOOLS } from './tools'
import type { SessionMessage } from './state'

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
}

function truncate(text: string, max = 8000): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`
}

function buildPrompt(options: {
  message: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  chatHistory?: string[]
  userName?: string
}): string {
  const parts: string[] = []

  if (options.userName) {
    parts.push(`User: ${options.userName}`)
  }

  if (options.chatHistory && options.chatHistory.length > 0) {
    const recent = options.chatHistory.slice(-6)
    parts.push('Recent chat history:\n' + recent.join('\n'))
  }

  if (options.workflowSummary) {
    parts.push(options.workflowSummary)
  }

  if (options.contexts && options.contexts.length > 0) {
    const ctxStrings = options.contexts.map((ctx) => {
      const label = ctx.tag || ctx.type
      return `- ${label}: ${truncate(ctx.content, 2000)}`
    })
    parts.push('Attached contexts:\n' + ctxStrings.join('\n'))
  }

  parts.push(
    'Behavior: prefer using tools before asking the user for details you can fetch yourself. For workflow review/edit/run/introspection requests, call the relevant tools immediately.'
  )
  parts.push(
    'Respond as JSON with fields: reply (string, the message for the user), reasoning (short string), operations (optional array of edit_workflow operations), toolCalls (array of tool calls). Each operation: {"operation_type":"add|edit|delete","block_id":string,"params":object}. Keep operations minimal and safe.'
  )
  parts.push(
    'If you need to call a tool, include toolCalls as an array: [{ "name": "<tool_name>", "arguments": { ... } }]. Use only the tools listed below.'
  )
  const toolsText = COPILOT_TOOLS.map(
    (t) => `- ${t.name}: ${t.description}. Args: ${t.arguments}`
  ).join('\n')
  parts.push('Allowed tools:\n' + toolsText)
  parts.push(
    'Tool usage rules:\n' +
      '- For "review my workflow" or similar, call get_user_workflow first to fetch the workflow instead of asking the user to share it.\n' +
      '- To understand block parameters, call get_blocks_metadata (and get_blocks_and_tools if needed).\n' +
      '- To inspect executions/logs, call get_workflow_console.\n' +
      '- To read docs, call search_documentation before guessing.\n' +
      '- To read variables, call get_environment_variables or get_global_workflow_variables before asking.\n' +
      '- Never ask the user for data that an allowed tool can fetch.\n' +
      '- Do NOT say you added/edited/deleted anything unless you emitted an edit_workflow tool call and it succeeded. If no edit_workflow tool ran, only propose changes and ask the user to run/approve them.\n' +
      '- After each tool result, decide the next best tool and keep calling tools until no further tool is helpful. Do not give a final summary or declare completion if more tool calls could improve the answer.\n'
  )
  parts.push(
    'Examples:\n' +
      '- User: "Review my workflow" -> toolCalls: [{"name":"get_user_workflow","arguments":{}}]\n' +
      '- User: "What blocks do I have?" -> toolCalls: [{"name":"get_blocks_and_tools","arguments":{}}]\n' +
      '- User: "Check logs for the last run" -> toolCalls: [{"name":"get_workflow_console","arguments":{"includeDetails":true}}]\n'
  )
  parts.push('User request:\n' + options.message)

  return parts.join('\n\n')
}

export async function generateAgentResponse(options: {
  message: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  messages?: SessionMessage[]
  userName?: string
  model?: string
}): Promise<AgentResponse> {
  const completion = await getGatewayCompletion({
    userMessage: options.message,
    workflowSummary: options.workflowSummary,
    contexts: options.contexts,
    history: options.messages,
    userName: options.userName,
    model: options.model,
  })

  return {
    reply: completion.content,
    operations: completion.operations,
    reasoning: completion.reasoning,
    toolCalls: completion.toolCalls,
    model: completion.model || options.model || config.defaultModel,
  }
}
