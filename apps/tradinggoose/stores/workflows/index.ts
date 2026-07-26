import { createLogger } from '@/lib/logs/console/logger'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

const logger = createLogger('Workflows')

function getYjsWorkflowState(workflowId: string): WorkflowState | null {
  const snapshot = getSnapshotForWorkflow(workflowId)
  if (!snapshot) return null
  return {
    blocks: snapshot.blocks ?? {},
    edges: snapshot.edges ?? [],
    loops: snapshot.loops ?? {},
    parallels: snapshot.parallels ?? {},
    lastSaved: snapshot.lastSaved,
  } as WorkflowState
}

/**
 * Get a workflow with its state merged in by ID
 * Reads state from the Yjs session for the given workflow.
 * @param workflowId ID of the workflow to retrieve
 * @returns The workflow with state values or null if no live session exists
 */
export function readWorkflowWithValues(workflowId: string) {
  const registryState = useWorkflowRegistry.getState()
  const { workflows } = registryState

  const workflowState = getYjsWorkflowState(workflowId)
  if (!workflowState) {
    logger.warn(`No Yjs session for workflow ${workflowId}`)
    return null
  }

  const metadata = workflows[workflowId]

  const deploymentStatus = useWorkflowRegistry.getState().readWorkflowDeploymentStatus(workflowId)

  return {
    id: workflowId,
    name: metadata?.name ?? '',
    description: metadata?.description,
    color: metadata?.color || '#3972F6',
    workspaceId: metadata?.workspaceId,
    folderId: metadata?.folderId,
    state: {
      blocks: workflowState.blocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
      lastSaved: workflowState.lastSaved,
      isDeployed: deploymentStatus?.isDeployed || false,
      deployedAt: deploymentStatus?.deployedAt,
    },
  }
}

export { useWorkflowRegistry } from '@/stores/workflows/registry/store'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { mergeSubblockState } from '@/stores/workflows/utils'
export type { WorkflowState } from '@/stores/workflows/workflow/types'
