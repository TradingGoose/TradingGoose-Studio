import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { ensureUniqueBlockIds, ensureUniqueEdgeIds } from '@/lib/workflows/db-helpers'
import {
  applyWorkflowMetadataInSocketServer,
  applyWorkflowStateInSocketServer,
} from '@/lib/yjs/server/snapshot-bridge'
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
  const { deployedAt, ...storedStateFields } = normalizedWorkflowState
  const storedWorkflowState = createWorkflowSnapshot({
    ...storedStateFields,
    lastSaved: syncedAt.toISOString(),
    ...(deployedAt
      ? { deployedAt: typeof deployedAt === 'string' ? deployedAt : deployedAt.toISOString() }
      : {}),
  })

  await applyWorkflowStateInSocketServer(workflowId, storedWorkflowState, variables, metadata)
}

export async function applyWorkflowMetadata(
  workflowId: string,
  metadata: WorkflowMetadataPatch
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowMetadataInSocketServer(workflowId, metadata)

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
