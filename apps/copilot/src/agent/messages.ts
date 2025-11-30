import { SYSTEM_PROMPT } from '../core/config'
import type { AiRouterMessage } from '../llm/ai-router'
import type { SessionMessage } from '../chat/state'
import type { AgentContextItem, AgentMode } from './types'
import { buildToolingInstruction } from './tooling'

export function truncate(text: string, max = 4000): string {
  if (!text) return ''
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...[truncated ${text.length - max} chars]`
}

export function mapHistoryMessages(history?: SessionMessage[]): AiRouterMessage[] {
  if (!history || history.length === 0) return []
  const msgs: AiRouterMessage[] = []
  const allowedToolCallIds = new Set<string>()

  for (const m of history) {
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      const toolCalls = m.toolCalls
        .map((tc, idx) => ({
          id: tc.id || `tool_${idx}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        }))
        .filter((tc) => !!tc.id)

      for (const tc of toolCalls) {
        allowedToolCallIds.add(tc.id)
      }

      if (toolCalls.length > 0) {
        msgs.push({ role: 'assistant', content: m.content ?? '', tool_calls: toolCalls })
      } else {
        msgs.push({ role: 'assistant', content: m.content ?? '' })
      }
      continue
    }

    if (m.role === 'tool') {
      const tcId = m.toolCallId || (m.name ? `tool_${m.name}` : undefined)
      if (tcId && allowedToolCallIds.has(tcId)) {
        msgs.push({
          role: 'tool',
          name: m.name,
          content: m.content ?? '',
          tool_call_id: tcId,
        })
      }
      // Skip orphaned tool messages without a matching assistant tool call
      continue
    }

    msgs.push({ role: m.role, content: m.content ?? '', name: m.name })
  }

  return msgs
}

export function buildMessages(input: {
  userMessage: string
  workflowSummary?: string
  contexts?: AgentContextItem[]
  history?: SessionMessage[]
  userName?: string
  allowedTools: Array<{ name: string; description: string; arguments: string }>
  mode: AgentMode
}): AiRouterMessage[] {
  const msgs: AiRouterMessage[] = []
  msgs.push({ role: 'system', content: SYSTEM_PROMPT })
  msgs.push({ role: 'system', content: buildToolingInstruction(input.mode, input.allowedTools) })
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
