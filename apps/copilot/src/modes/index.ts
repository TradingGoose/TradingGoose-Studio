import { agentMode } from './agent'
import { askMode } from './ask'

export interface CopilotModeDefinition {
  id: string
  label: string
  systemPrompt: string
  toolInstructions?: string[]
  allowedToolNames?: string[]
}

const MODE_LIST = [agentMode, askMode] as const

export type CopilotModeId = (typeof MODE_LIST)[number]['id']

export const COPILOT_MODE_IDS = MODE_LIST.map((mode) => mode.id) as [
  CopilotModeId,
  ...CopilotModeId[],
]

export const COPILOT_MODE_MAP: Record<CopilotModeId, CopilotModeDefinition> = MODE_LIST.reduce(
  (acc, mode) => {
    acc[mode.id as CopilotModeId] = mode
    return acc
  },
  {} as Record<CopilotModeId, CopilotModeDefinition>
)

export function getCopilotModeDefinition(mode?: string): CopilotModeDefinition {
  if (mode && mode in COPILOT_MODE_MAP) {
    return COPILOT_MODE_MAP[mode as CopilotModeId]
  }
  return COPILOT_MODE_MAP['agent']
}

export { agentMode, askMode }
