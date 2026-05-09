export type CopilotAccessLevel = 'limited' | 'full'

export function shouldAutoExecuteTool(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}

export function shouldRequireCopilotApproval(accessLevel: CopilotAccessLevel): boolean {
  return !shouldAutoExecuteTool(accessLevel)
}
