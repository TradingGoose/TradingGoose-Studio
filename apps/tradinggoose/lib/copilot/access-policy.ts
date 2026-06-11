export type CopilotAccessLevel = 'limited' | 'full'

function shouldAutoExecuteTool(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}

export function shouldRequireToolApproval(
  accessLevel: CopilotAccessLevel,
  gated: boolean
): boolean {
  return gated && !shouldAutoExecuteTool(accessLevel)
}
