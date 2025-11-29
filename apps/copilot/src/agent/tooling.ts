import { COPILOT_TOOLS } from '../tools'
import type { AiRouterTool } from '../llm/ai-router'
import type { AgentMode } from './types'

const ASK_MODE_TOOL_BLOCKLIST = new Set([
  'edit_workflow',
  'run_workflow',
  'set_environment_variables',
  'set_global_workflow_variables',
  'make_api_request',
])

export function toolsForMode(mode: AgentMode) {
  if (mode === 'ask') {
    return COPILOT_TOOLS.filter((t) => !ASK_MODE_TOOL_BLOCKLIST.has(t.name))
  }
  return COPILOT_TOOLS
}

export function buildToolingInstruction(mode: AgentMode, allowedTools: typeof COPILOT_TOOLS): string {
  const toolsText = allowedTools
    .map((t) => `- ${t.name}: ${t.description}. Args: ${t.arguments}`)
    .join('\n')

  return [
    [
      `Mode: ${mode.toUpperCase()}.`,
      mode === 'ask'
        ? 'Read-only mode: do not use editing or mutating tools. Stick to analysis, inspection, and planning.'
        : 'Full agent mode: you may edit and run workflows when appropriate.',
    ].join(' '),
    'Use tools before asking the user. Respond as JSON { reply, reasoning?, operations?, toolCalls? }. Each edit operation: {"operation_type":"add|edit|delete","block_id":string,"params":object}.',
    [
      'Tool rules:',
      '- Fetch workflow: get_user_workflow.',
      '- Learn schemas: get_blocks_and_tools.',
      '- Get params for every block you will change: get_blocks_metadata (retry with explicit block_ids if empty).',
      '- Do not guess IDs/params/connections/ports; fetch them.',
      '- Preserve connection direction; when inserting, keep original source and reattach downstream to the new block.',
      '- Multiple tool calls are OK, but every tool_call_id must get a tool_result before you move on.',
      '- When changing workflows, emit edit_workflow with concrete operations; do not just describe.',
      '- Always call plan first (before other tools) to design/plan your action with todo list.',
      '- Move todos to in-progress with mark_todo_in_progress, and check them off with checkoff_todo as you finish.',
      '- If the conversation is long and you need a recap, call summarize_conversation before continuing.',
      mode === 'ask' ? '- Skip edit/mutate tools entirely in ASK mode.' : '',
    ].join('\n'),
    'Allowed tools:\n' + toolsText,
  ].join('\n\n')
}

export function buildToolsForAiRouter(tools: typeof COPILOT_TOOLS): AiRouterTool[] {
  // OpenAI-style tool definitions with permissive schemas to encourage function calling
  return tools.map((t) => ({
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
