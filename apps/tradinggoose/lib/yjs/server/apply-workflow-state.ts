import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import { getRedisStorageMode } from '@/lib/redis'
import { saveWorkflowToNormalizedTables } from '@/lib/workflows/db-helpers'
import {
  applyWorkflowStateInSocketServer,
  SocketServerBridgeError,
} from '@/lib/yjs/server/snapshot-bridge'
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
  } catch (error) {
    if (error instanceof SocketServerBridgeError || getRedisStorageMode() !== 'redis') {
      throw error
    }

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

  await applyWorkflowStateToYjs(workflowId, appliedWorkflowState, variables, entityName)

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
