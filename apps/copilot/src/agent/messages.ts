import type { AiRouterMessage } from '../llm/ai-router'
import type { SessionMessage } from '../chat/state'
import type { AgentContextItem } from './types'
import type { CopilotModeDefinition } from '../modes'
import { buildToolingInstruction } from './tooling'

const CONTEXT_TOOL_GUIDANCE: Record<string, string> = {
  logs:
    'Logs were attached; cite them directly and call get_workflow_console for the same execution when you need additional detail.',
  workflow:
    'Workflow snapshots were included; run get_user_workflow and inspect specific blocks via get_blocks_metadata before editing.',
  current_workflow:
    'Current workflow state was provided; refresh it with get_user_workflow/get_blocks_metadata to ensure your edits match reality.',
  workflow_block:
    'Specific workflow blocks were referenced; fetch their schema via get_blocks_metadata before modifying them.',
  blocks:
    'Block metadata was attached; use get_blocks_metadata or get_blocks_and_tools to verify block inputs/outputs you plan to change.',
  past_chat:
    'Past chat context was supplied; call summarize_conversation if you need to recap decisions before acting.',
  knowledge:
    'Knowledge base content was attached; use search_documentation or get_examples_rag to retrieve related entries when needed.',
  templates:
    'Template context is provided; call get_examples_rag or get_operations_examples to explore similar templates before responding.',
  docs:
    'Documentation snippets were included; query search_documentation to pull the relevant docs again if additional detail is necessary.',
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
  modeDefinition: CopilotModeDefinition
  customSystemPrompt?: string
  appendUserMessage?: boolean
}): AiRouterMessage[] {
  const msgs: AiRouterMessage[] = []
  const systemPromptContent =
    input.customSystemPrompt && input.customSystemPrompt.trim() !== ''
      ? input.customSystemPrompt
      : input.modeDefinition.systemPrompt
  msgs.push({ role: 'system', content: systemPromptContent })
  msgs.push({
    role: 'system',
    content: buildToolingInstruction(input.modeDefinition, input.allowedTools),
  })
  if (input.userName) msgs.push({ role: 'system', content: `User: ${input.userName}` })
  if (input.workflowSummary) msgs.push({ role: 'system', content: input.workflowSummary })
  if (input.contexts?.length) {
    const contextTypes = Array.from(new Set(input.contexts.map((c) => c.type)))
    const toolGuidance = contextTypes
      .map((type) => CONTEXT_TOOL_GUIDANCE[type])
      .filter((line): line is string => typeof line === 'string' && line.length > 0)

    if (toolGuidance.length > 0) {
      msgs.push({
        role: 'system',
        content:
          'Context handling rules:\n' +
          [
            'Use the provided context as ground truth and refresh or extend it with the matching tools before acting.',
            ...toolGuidance.map((line) => `- ${line}`),
          ].join('\n'),
      })
    }

    const ctxText = input.contexts
      .map((c) => {
        const label = c.tag ? `${c.tag} (${c.type})` : c.type
        return `- ${label}: ${c.content}`
      })
      .join('\n')
    msgs.push({ role: 'system', content: 'Attached contexts:\n' + ctxText })
  }

  msgs.push(...mapHistoryMessages(input.history))
  if (input.appendUserMessage !== false && input.userMessage && input.userMessage.length > 0) {
    msgs.push({ role: 'user', content: input.userMessage })
  }
  return msgs
}
