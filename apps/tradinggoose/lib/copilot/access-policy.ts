export type CopilotAccessLevel = 'limited' | 'full'

export function shouldAutoExecuteTool(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}

export function shouldRequireToolApproval(
  accessLevel: CopilotAccessLevel,
  gated: boolean
): boolean {
  return gated && !shouldAutoExecuteTool(accessLevel)
}
