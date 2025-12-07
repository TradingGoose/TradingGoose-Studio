import type { CopilotModeDefinition } from './index'

export const wandMode: CopilotModeDefinition = {
  id: 'wand',
  label: 'Wand',
  systemPrompt:
    'You are Wand mode. Follow the user-provided system prompt exactly when it is supplied, and only resort to this default when no custom prompt is provided.',
  toolInstructions: [
    'Treat the user-supplied system prompt as the primary instruction set when provided.',
    'Call support tools (get_blocks_metadata, get_user_workflow) only when the wand prompt explicitly requests it.',
  ],
}
