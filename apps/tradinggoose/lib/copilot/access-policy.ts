export type CopilotAccessLevel = 'limited' | 'full'

export function shouldRequireToolApproval(
  accessLevel: CopilotAccessLevel,
  gated: boolean
): boolean {
  return gated && accessLevel !== 'full'
}
