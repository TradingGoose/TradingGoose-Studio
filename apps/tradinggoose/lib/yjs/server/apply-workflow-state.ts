import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import { applyWorkflowStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import { createWorkflowSnapshot, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'

export async function applyWorkflowState(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>,
  entityName?: string
): Promise<void> {
  const syncedAt = new Date()
  const appliedWorkflowState = createWorkflowSnapshot({
    ...workflowState,
    lastSaved: syncedAt.toISOString(),
  })

  await applyWorkflowStateInSocketServer(workflowId, appliedWorkflowState, variables, entityName)

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, appliedWorkflowState)
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to materialize workflow state')
  }

  await db
    .update(workflow)
    .set({
      lastSynced: syncedAt,
      updatedAt: syncedAt,
      ...(variables === undefined ? {} : { variables }),
    })
    .where(eq(workflow.id, workflowId))
}

export async function applyWorkflowEntityName(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables: Record<string, any>,
  entityName: string
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowStateInSocketServer(workflowId, workflowState, variables, entityName)

  const [updatedWorkflow] = await db
    .update(workflow)
    .set({ name: entityName, updatedAt: new Date() })
    .where(eq(workflow.id, workflowId))
    .returning()

  if (!updatedWorkflow) {
    throw new Error('Workflow not found')
  }

  return updatedWorkflow
}
