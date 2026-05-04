export type CopilotAccessLevel = 'limited' | 'full'

export function shouldBypassCopilotApproval(accessLevel: CopilotAccessLevel): boolean {
  return accessLevel === 'full'
}

export function shouldRequireCopilotApproval(accessLevel: CopilotAccessLevel): boolean {
  return !shouldBypassCopilotApproval(accessLevel)
}

export function shouldAutoExecuteCopilotTool(
  accessLevel: CopilotAccessLevel,
  hasInterrupt: boolean,
  entersReviewState = false
): boolean {
  return shouldBypassCopilotApproval(accessLevel) || entersReviewState || !hasInterrupt
}

export function shouldAutoExecuteIntegrationTool(accessLevel: CopilotAccessLevel): boolean {
  return shouldBypassCopilotApproval(accessLevel)
}
