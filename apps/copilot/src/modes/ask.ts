import { COPILOT_TOOLS } from '../services/tools'
import type { CopilotModeDefinition } from './index'

const MUTATING_TOOL_BLOCKLIST = [
  'edit_workflow',
  'run_workflow',
  'set_environment_variables',
  'set_global_workflow_variables',
  'make_api_request',
] as const

const mutatingSet = new Set(MUTATING_TOOL_BLOCKLIST)
const ASK_SAFE_TOOL_NAMES = COPILOT_TOOLS.filter((tool) => !mutatingSet.has(tool.name)).map(
  (tool) => tool.name
)

export const askMode: CopilotModeDefinition = {
  id: 'ask',
  label: 'Ask',
  systemPrompt:
    'You are TradingGoose Copilot operating in ASK mode. Provide analysis, planning help, and documentation without modifying the workflow. ' +
    'Favor clear explanations, cite evidence from retrieved context, and suggest next steps the user can apply in Agent mode.',
  allowedToolNames: ASK_SAFE_TOOL_NAMES,
  toolInstructions: [
    'Respond as JSON { reply, reasoning?, operations?, toolCalls? }. You should normally omit operations in ASK mode.',
    'Stay read-only: never call edit_workflow, run_workflow, make_api_request, or environment mutation tools. If the user asks for a change, explain why it requires Agent mode.',
    'Use get_user_workflow, get_blocks_and_tools, search_documentation, and similar inspection tools to gather facts before answering.',
    'Plan your approach and summarize findings so the user can implement or switch to Agent mode confidently.',
  ],
}
