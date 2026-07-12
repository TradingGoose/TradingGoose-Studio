export const WORKFLOW_FIT_VIEW_PADDING = 0.3

export function shouldAutoFitWorkflowView(args: {
  previousIdentity: string | null
  nextIdentity: string | null
  previousNodeCount: number
  nextNodeCount: number
  isWorkflowReady: boolean
}): boolean {
  const {
    previousIdentity,
    nextIdentity,
    previousNodeCount,
    nextNodeCount,
    isWorkflowReady,
  } = args

  if (!isWorkflowReady || !nextIdentity || nextNodeCount === 0) {
    return false
  }

  if (previousIdentity !== nextIdentity) {
    return true
  }

  return previousNodeCount === 0 && nextNodeCount > 0
}
