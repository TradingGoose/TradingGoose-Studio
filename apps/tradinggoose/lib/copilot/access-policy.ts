export type CopilotAccessLevel = 'limited' | 'full'

export function shouldAutoExecuteCopilotTool(
  accessLevel: CopilotAccessLevel,
  hasInterrupt: boolean
): boolean {
  return accessLevel === 'full' || !hasInterrupt
}

export function shouldAutoExecuteIntegrationTool(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}

export function shouldAutoApplyWorkflowEdits(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}
