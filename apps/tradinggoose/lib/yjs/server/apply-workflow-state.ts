import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import { ensureUniqueBlockIds, ensureUniqueEdgeIds } from '@/lib/workflows/db-helpers'
import {
  applyWorkflowEntityNameInSocketServer,
  applyWorkflowStateInSocketServer,
} from '@/lib/yjs/server/snapshot-bridge'
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

  await applyWorkflowStateInSocketServer(workflowId, storedWorkflowState, variables, entityName)
}

export async function applyWorkflowEntityName(
  workflowId: string,
  entityName: string
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowEntityNameInSocketServer(workflowId, entityName)

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
