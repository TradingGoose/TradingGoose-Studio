import { db, workflow } from '@tradinggoose/db'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import {
  ensureUniqueBlockIds,
  ensureUniqueEdgeIds,
  saveWorkflowToNormalizedTables,
} from '@/lib/workflows/db-helpers'
import {
  applyWorkflowStateInSocketServer,
  getYjsSnapshot,
} from '@/lib/yjs/server/snapshot-bridge'
import {
  createWorkflowSnapshot,
  extractPersistedStateFromDoc,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'

async function readAppliedYjsWorkflowState(workflowId: string): Promise<{
  workflowState: WorkflowSnapshot
  variables: Record<string, any>
}> {
  const snapshot = await getYjsSnapshot(
    workflowId,
    serializeYjsTransportEnvelope(
      buildYjsTransportEnvelope({
        workspaceId: null,
        entityKind: 'workflow',
        entityId: workflowId,
        draftSessionId: null,
        reviewSessionId: null,
        yjsSessionId: workflowId,
      })
    )
  )

  if (!snapshot.snapshotBase64) {
    throw new Error(`Workflow ${workflowId} Yjs state is missing`)
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    const state = extractPersistedStateFromDoc(doc)
    return {
      workflowState: createWorkflowSnapshot({
        ...(state.direction !== undefined ? { direction: state.direction } : {}),
        blocks: state.blocks,
        edges: state.edges,
        loops: state.loops,
        parallels: state.parallels,
        lastSaved: new Date(state.lastSaved).toISOString(),
        isDeployed: state.isDeployed,
        deployedAt: state.deployedAt,
      }),
      variables: state.variables,
    }
  } finally {
    doc.destroy()
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

  await applyWorkflowStateInSocketServer(workflowId, storedWorkflowState, variables, entityName)

  const appliedState = await readAppliedYjsWorkflowState(workflowId)
  const saveResult = await saveWorkflowToNormalizedTables(
    workflowId,
    appliedState.workflowState,
    async (tx) => {
      const [updatedWorkflow] = await tx
        .update(workflow)
        .set({
          lastSynced: syncedAt,
          updatedAt: syncedAt,
          variables: appliedState.variables,
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
}

export async function applyWorkflowEntityName(
  workflowId: string,
  workflowState: WorkflowSnapshot,
  variables: Record<string, any>,
  entityName: string,
  fields: Partial<typeof workflow.$inferInsert> = {}
): Promise<typeof workflow.$inferSelect> {
  await applyWorkflowStateInSocketServer(workflowId, workflowState, variables, entityName)

  const [updatedWorkflow] = await db
    .update(workflow)
    .set({ ...fields, name: entityName, updatedAt: fields.updatedAt ?? new Date() })
    .where(eq(workflow.id, workflowId))
    .returning()

  if (!updatedWorkflow) {
    throw new Error('Workflow not found')
  }

  return updatedWorkflow
}
