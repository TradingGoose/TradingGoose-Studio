import { createLogger } from '@/lib/logs/console/logger'
import { getSnapshotForWorkflow } from '@/lib/yjs/workflow-session-registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { BlockState, WorkflowState } from '@/stores/workflows/workflow/types'

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
    isDeployed: snapshot.isDeployed,
    deployedAt: snapshot.deployedAt,
  } as WorkflowState
}

/**
 * Get a workflow with its state merged in by ID
 * Reads state from the Yjs session for the given workflow.
 * @param workflowId ID of the workflow to retrieve
 * @returns The workflow with state values or null if not found/not active
 */
export function getWorkflowWithValues(workflowId: string, channelId?: string) {
  const registryState = useWorkflowRegistry.getState()
  const { workflows } = registryState
  const activeWorkflowId =
    typeof registryState.getActiveWorkflowId === 'function'
      ? registryState.getActiveWorkflowId(channelId)
      : null

  if (!workflows[workflowId]) {
    logger.warn(`Workflow ${workflowId} not found`)
    return null
  }

  // Only return data for active workflow with a live Yjs session
  if (workflowId !== activeWorkflowId) {
    logger.warn(`Cannot get state for non-active workflow ${workflowId}`)
    return null
  }

  const workflowState = getYjsWorkflowState(workflowId)
  if (!workflowState) {
    logger.warn(`No Yjs session for workflow ${workflowId}`)
    return null
  }

  const metadata = workflows[workflowId]

  // Get deployment status from registry
  const deploymentStatus = useWorkflowRegistry.getState().getWorkflowDeploymentStatus(workflowId)

  return {
    id: workflowId,
    name: metadata.name,
    description: metadata.description,
    color: metadata.color || '#3972F6',
    marketplaceData: metadata.marketplaceData || null,
    workspaceId: metadata.workspaceId,
    folderId: metadata.folderId,
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

/**
 * Get a specific block with its subblock values merged in
 * @param blockId ID of the block to retrieve
 * @returns The block with subblock values or null if not found
 */
export function getBlockWithValues(blockId: string, channelId?: string): BlockState | null {
  const registryState = useWorkflowRegistry.getState()
  const activeWorkflowId =
    typeof registryState.getActiveWorkflowId === 'function'
      ? registryState.getActiveWorkflowId(channelId)
      : null

  if (!activeWorkflowId) return null

  const workflowState = getYjsWorkflowState(activeWorkflowId)
  if (!workflowState || !workflowState.blocks[blockId]) return null

  return workflowState.blocks[blockId] || null
}

/**
 * Get all workflows with their values
 * Only includes the active workflow state (read from Yjs).
 * @returns An object containing workflows, with state only for the active workflow
 */
export function getAllWorkflowsWithValues(channelId?: string) {
  const { workflows } = useWorkflowRegistry.getState()
  const result: Record<string, any> = {}
  const activeWorkflowId = useWorkflowRegistry.getState().getActiveWorkflowId(channelId)

  // Only sync the active workflow to ensure we always send valid state data
  if (activeWorkflowId && workflows[activeWorkflowId]) {
    const metadata = workflows[activeWorkflowId]

    const workflowState = getYjsWorkflowState(activeWorkflowId)
    if (!workflowState) return result

    // Get deployment status from registry
    const deploymentStatus = useWorkflowRegistry
      .getState()
      .getWorkflowDeploymentStatus(activeWorkflowId)

    // Include the API key in the state if it exists in the deployment status
    const apiKey = deploymentStatus?.apiKey

    result[activeWorkflowId] = {
      id: activeWorkflowId,
      name: metadata.name,
      description: metadata.description,
      color: metadata.color || '#3972F6',
      marketplaceData: metadata.marketplaceData || null,
      folderId: metadata.folderId,
      state: {
        blocks: workflowState.blocks,
        edges: workflowState.edges,
        loops: workflowState.loops,
        parallels: workflowState.parallels,
        lastSaved: workflowState.lastSaved,
        isDeployed: deploymentStatus?.isDeployed || false,
        deployedAt: deploymentStatus?.deployedAt,
        marketplaceData: metadata.marketplaceData || null,
      },
      // Include API key if available
      apiKey,
    }

    // Only include workspaceId if it's not null/undefined
    if (metadata.workspaceId) {
      result[activeWorkflowId].workspaceId = metadata.workspaceId
    }
  }

  return result
}

export { useWorkflowRegistry } from '@/stores/workflows/registry/store'
export type { WorkflowMetadata } from '@/stores/workflows/registry/types'
export { mergeSubblockState } from '@/stores/workflows/utils'
export type { WorkflowState } from '@/stores/workflows/workflow/types'

