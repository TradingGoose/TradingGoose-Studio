import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  WorkflowRealtimeRequiredError,
} from '@/lib/workflows/db-helpers'
import { applyWorkflowPatchInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  createWorkflowSnapshot,
  type WorkflowMetadataPatch,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'

export async function applyWorkflowState(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>,
  metadata?: WorkflowMetadataPatch
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
      ...(metadata ? { metadata } : {}),
    })
  } catch (error) {
    throw new WorkflowRealtimeRequiredError(error)
  }
}

export async function applyWorkflowMetadata(
  workflowId: string,
  metadata: WorkflowMetadataPatch
): Promise<typeof workflow.$inferSelect> {
  try {
    await applyWorkflowPatchInSocketServer(workflowId, { metadata })
  } catch (error) {
    throw new WorkflowRealtimeRequiredError(error)
  }

  const [updatedWorkflow] = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)
  if (!updatedWorkflow) {
    throw new Error('Workflow not found')
  }

  return updatedWorkflow
}
