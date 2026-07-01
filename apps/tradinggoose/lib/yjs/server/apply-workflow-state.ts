import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  WorkflowRealtimeRequiredError,
} from '@/lib/workflows/db-helpers'
import { applyWorkflowPatchInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'

export async function applyWorkflowState(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): Promise<void> {
  const syncedAt = new Date()
  const appliedWorkflowState = createWorkflowSnapshot({
    ...workflowState,
    lastSaved: syncedAt.toISOString(),
  })

  const normalizedWorkflowState = await ensureUniqueEdgeIds(
    workflowId,
    await ensureUniqueBlockIds(workflowId, appliedWorkflowState)
  )
  const storedWorkflowState = createWorkflowSnapshot({
    ...normalizedWorkflowState,
    lastSaved: syncedAt.toISOString(),
  })

  try {
    await applyWorkflowPatchInSocketServer(workflowId, {
      workflowState: storedWorkflowState,
      ...(variables === undefined ? {} : { variables }),
    })
  } catch (error) {
    throw new WorkflowRealtimeRequiredError(error)
  }
}
