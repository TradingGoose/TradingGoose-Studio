import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import {
  applyWorkflowStateInSocketServer,
  deleteYjsSessionInSocketServer,
} from '@/lib/yjs/server/snapshot-bridge'
import {
  createWorkflowSnapshot,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'

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

  try {
    const saveResult = await saveWorkflowToNormalizedTables(
      workflowId,
      storedWorkflowState,
      async (tx) => {
        const [updatedWorkflow] = await tx
          .update(workflow)
          .set({
            lastSynced: syncedAt,
            updatedAt: syncedAt,
            ...(variables === undefined ? {} : { variables }),
          })
          .where(eq(workflow.id, workflowId))
          .returning({ id: workflow.id })

        if (!updatedWorkflow) {
          throw new Error('Workflow not found')
        }
      }
    )
    if (!saveResult.success) {
      throw new Error(saveResult.error || 'Failed to materialize workflow state')
    }
  } catch (error) {
    await deleteYjsSessionInSocketServer(workflowId)
    throw error
  }
}

export async function applyWorkflowEntityName(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables: Record<string, any>,
  entityName: string,
  fields: Partial<typeof workflow.$inferInsert> = {}
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowStateInSocketServer(workflowId, workflowState, variables, entityName)

  try {
    const [updatedWorkflow] = await db
      .update(workflow)
      .set({ ...fields, name: entityName, updatedAt: fields.updatedAt ?? new Date() })
      .where(eq(workflow.id, workflowId))
      .returning()

    if (!updatedWorkflow) {
      throw new Error('Workflow not found')
    }

    return updatedWorkflow
  } catch (error) {
    await deleteYjsSessionInSocketServer(workflowId)
    throw error
  }
}
