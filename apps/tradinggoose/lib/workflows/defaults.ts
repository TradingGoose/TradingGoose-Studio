import type { WorkflowState } from '@/stores/workflows/workflow/types'

export interface DefaultWorkflowArtifacts {
  workflowState: WorkflowState
  subBlockValues: Record<string, Record<string, unknown>>
}

export function buildDefaultWorkflowArtifacts(): DefaultWorkflowArtifacts {
  const workflowState: WorkflowState = {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
    lastSaved: Date.now(),
    isDeployed: false,
    deployedAt: undefined,
    deploymentStatuses: {},
    needsRedeployment: false,
  }

  return {
    workflowState,
    subBlockValues: {},
  }
}
