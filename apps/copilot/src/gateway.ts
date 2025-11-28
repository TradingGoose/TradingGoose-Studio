import { config, SYSTEM_PROMPT } from './config'
import type { AgentContextItem } from './agent'
import { COPILOT_TOOLS } from './tools'
import type { SessionMessage } from './state'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string
  name?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface GatewayCompletion {
  content: string
  reasoning?: string
  operations?: any[]
  model: string
  toolCalls?: Array<{ id?: string; name: string; arguments?: Record<string, any> }>
}

function truncate(text: string, max = 4000): string {
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`
}

function buildToolingInstruction(): string {
  const toolsText = COPILOT_TOOLS.map((t) => `- ${t.name}: ${t.description}. Args: ${t.arguments}`).join('\n')

  return [
    'Use tools before asking the user. Respond as JSON { reply, reasoning?, operations?, toolCalls? }. Each edit operation: {"operation_type":"add|edit|delete","block_id":string,"params":object}.',
    'Tool rules:\n- Fetch workflow: get_user_workflow.\n- Learn schemas: get_blocks_and_tools.\n- Get params for every block you will change: get_blocks_metadata (retry with explicit block_ids if empty).\n- Do not guess IDs/params/connections/ports; fetch them.\n- Preserve connection direction; when inserting, keep original source and reattach downstream to the new block.\n- Multiple tool calls are OK, but every tool_call_id must get a tool_result before you move on.\n- When changing workflows, emit edit_workflow with concrete operations; do not just describe.',
    'Allowed tools:\n' + toolsText,
  ].join('\n\n')
}

function mapHistoryMessages(history?: SessionMessage[]): ChatMessage[] {
  if (!history || history.length === 0) return []
  const toolResponses = new Set<string>()
  for (const m of history) {
    if (m.role === 'tool' && m.toolCallId) {
      toolResponses.add(m.toolCallId)
    }
  }
  return history.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        name: m.name,
        content: m.content ?? '',
        tool_call_id: m.toolCallId || (m.name ? `tool_${m.name}` : undefined),
      }
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const toolCalls = m.toolCalls
        .map((tc, idx) => ({
          id: tc.id || `tool_${idx}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        }))
        .filter((tc) => toolResponses.has(tc.id))

      if (toolCalls.length > 0) {
        return { role: 'assistant', content: m.content ?? '', tool_calls: toolCalls }
      }
      // If no matching tool responses exist, fall back to content-only to avoid invalid tool_call chains
      return { role: 'assistant', content: m.content ?? '' }
    }
    return { role: m.role, content: m.content ?? '', name: m.name }
  })
}

function buildMessages(input: {
  userMessage: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  history?: SessionMessage[]
  userName?: string
}): ChatMessage[] {
  const msgs: ChatMessage[] = []
  msgs.push({ role: 'system', content: SYSTEM_PROMPT })
  msgs.push({ role: 'system', content: buildToolingInstruction() })
  if (input.userName) msgs.push({ role: 'system', content: `User: ${input.userName}` })
  if (input.workflowSummary) msgs.push({ role: 'system', content: input.workflowSummary })
  if (input.contexts?.length) {
    const ctxText = input.contexts
      .map((c) => `- ${(c.tag || c.type)}: ${truncate(c.content, 2000)}`)
      .join('\n')
    msgs.push({ role: 'system', content: 'Attached contexts:\n' + ctxText })
  }

  msgs.push(...mapHistoryMessages(input.history))

  msgs.push({ role: 'user', content: input.userMessage })
  return msgs
}

function buildToolsForGateway() {
  // OpenAI-style tool definitions with permissive schemas to encourage function calling
  return COPILOT_TOOLS.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    },
  }))
}

export async function getGatewayCompletion(input: {
  userMessage: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  history?: SessionMessage[]
  userName?: string
  model?: string
}): Promise<GatewayCompletion> {
  const gatewayUrl = config.gatewayUrl
  const gatewayKey = config.gatewayApiKey
  if (!gatewayUrl || !gatewayKey) {
    return {
      content: 'LLM Gateway is not configured. Set LLM_GATEWAY_URL and LLM_GATEWAY_API_KEY.',
      model: input.model || config.defaultModel,
    }
  }

  const body = {
    model: input.model || config.defaultModel,
    stream: false,
    messages: buildMessages(input),
    tools: buildToolsForGateway(),
    tool_choice: 'auto' as const,
  }

  const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${gatewayKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    return {
      content: `Gateway error: ${res.status} ${res.statusText}`,
      model: body.model,
    }
  }

  const json = (await res.json().catch(() => null)) as any
  const message = json?.choices?.[0]?.message || {}
  const rawContent = message?.content || json?.content || ''

  // Handle tool_calls from OpenAI-style response
  let toolCalls: Array<{ id?: string; name: string; arguments?: Record<string, any> }> | undefined
  if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
    toolCalls = message.tool_calls.map((tc: any) => {
      let parsedArgs: Record<string, any> | undefined
      try {
        parsedArgs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : undefined
      } catch {
        parsedArgs = undefined
      }
      return {
        id: tc.id,
        name: tc.function?.name || tc.name,
        arguments: parsedArgs,
      }
    })
  }

  let content = ''
  let reasoning: string | undefined
  let operations: any[] | undefined

  if (typeof rawContent === 'string') {
    content = rawContent
    // Try to parse structured JSON reply
    try {
      const parsed = JSON.parse(rawContent)
      content = typeof parsed.reply === 'string' ? parsed.reply : content
      reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : reasoning
      operations = Array.isArray(parsed.operations) ? parsed.operations : operations
      if (parsed.toolCalls && Array.isArray(parsed.toolCalls)) {
        toolCalls = parsed.toolCalls
      }
    } catch {
      // ignore parse errors
    }
  } else if (rawContent && typeof rawContent === 'object') {
    const maybe = rawContent as any
    if (typeof maybe.reply === 'string') content = maybe.reply
    if (typeof maybe.reasoning === 'string') reasoning = maybe.reasoning
    if (Array.isArray(maybe.operations)) operations = maybe.operations
    if (maybe.toolCalls && Array.isArray(maybe.toolCalls)) toolCalls = maybe.toolCalls
  }

  return {
    content: content || (toolCalls?.length ? '' : 'No response generated.'),
    reasoning,
    operations,
    model: json?.model || body.model,
    toolCalls,
  }
}
