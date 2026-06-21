import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import { applyWorkflowStateInSocketServer } from '@/lib/yjs/server/snapshot-bridge'
import {
  createWorkflowSnapshot,
  replaceWorkflowDocumentState,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { getState, storeCanonicalState } from '@/socket-server/yjs/persistence'

async function storeWorkflowStateDirectly(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>,
  entityName?: string
) {
  const doc = new Y.Doc()
  try {
    const existingState = await getState(workflowId)
    if (existingState) {
      Y.applyUpdate(doc, existingState)
    }

    replaceWorkflowDocumentState(doc, workflowState, variables, entityName)
    await storeCanonicalState(workflowId, Y.encodeStateAsUpdate(doc))
  } finally {
    doc.destroy()
  }
}

async function applyWorkflowStateToYjs(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>,
  entityName?: string
) {
  try {
    await applyWorkflowStateInSocketServer(workflowId, workflowState, variables, entityName)
  } catch {
    await storeWorkflowStateDirectly(workflowId, workflowState, variables, entityName)
  }
}

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

  await applyWorkflowStateToYjs(workflowId, storedWorkflowState, variables, entityName)

  const saveResult = await saveWorkflowToNormalizedTables(workflowId, storedWorkflowState)
  if (!saveResult.success) {
    throw new Error(saveResult.error || 'Failed to materialize workflow state')
  }

  const [updatedWorkflow] = await db
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

export async function applyWorkflowEntityName(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables: Record<string, any>,
  entityName: string
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowStateToYjs(workflowId, workflowState, variables, entityName)

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
