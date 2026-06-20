import { db } from '@tradinggoose/db'
import { workflow } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import * as Y from 'yjs'
import {
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import type {
  ResolvedReviewTarget,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { loadWorkflowFromNormalizedTables } from '@/lib/workflows/db-helpers'
import { getYjsSnapshot, SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'
import type { WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import {
  getMetadataMap as readWorkflowMetadataMap,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import { getState as getPersistedYjsState } from '@/socket-server/yjs/persistence'

export class ReviewTargetBootstrapError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ReviewTargetBootstrapError'
    this.status = status
  }
}

const ACTIVE_RESEEDED_RUNTIME: ReviewTargetRuntimeState = {
  docState: 'active',
  replaySafe: false,
  reseededFromCanonical: true,
}

export function getRuntimeStateFromDoc(doc: Y.Doc): ReviewTargetRuntimeState {
  return getReviewTargetRuntimeState(doc)
}

export function getRuntimeStateFromUpdate(update: Uint8Array): ReviewTargetRuntimeState {
  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, update)
    return getRuntimeStateFromDoc(doc)
  } finally {
    doc.destroy()
  }
}

export async function readBootstrappedReviewTargetSnapshot(descriptor: ReviewTargetDescriptor) {
  const bridgeParams = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  try {
    return await getYjsSnapshot(descriptor.yjsSessionId, bridgeParams)
  } catch (error) {
    if (!(error instanceof SocketServerBridgeError) || error.status !== 404) {
      throw error
    }
  }

  const resolved = await bootstrapReviewTarget(descriptor)
  if (!resolved.runtime) {
    throw new ReviewTargetBootstrapError(500, 'Bootstrap runtime missing')
  }

  if (resolved.runtime.docState === 'expired') {
    return {
      snapshotBase64: '',
      descriptor: resolved.descriptor,
      runtime: resolved.runtime,
    }
  }

  const state = await getPersistedYjsState(resolved.descriptor.yjsSessionId)
  if (!state) {
    throw new ReviewTargetBootstrapError(500, 'Snapshot not available after bootstrap')
  }

  return {
    snapshotBase64: Buffer.from(state).toString('base64'),
    descriptor: resolved.descriptor,
    runtime: resolved.runtime,
  }
}

async function getExistingYjsState(sessionId: string): Promise<Uint8Array | null> {
  const [{ getExistingDocument }, { getState }] = await Promise.all([
    import('@/socket-server/yjs/upstream-utils'),
    import('@/socket-server/yjs/persistence'),
  ])

  const liveDoc = await getExistingDocument(sessionId)
  if (liveDoc) {
    return Y.encodeStateAsUpdate(liveDoc)
  }

  return getState(sessionId)
}

async function getBootstrapDoc(sessionId: string): Promise<Y.Doc> {
  const [{ getDocument, setPersistence }, { getState, storeState }] = await Promise.all([
    import('@/socket-server/yjs/upstream-utils'),
    import('@/socket-server/yjs/persistence'),
  ])

  setPersistence(sessionId, { getState, storeState })
  return getDocument(sessionId)
}

async function persistDoc(sessionId: string, doc: Y.Doc): Promise<void> {
  const { storeState } = await import('@/socket-server/yjs/persistence')
  const state = Y.encodeStateAsUpdate(doc)
  await storeState(sessionId, state)
}

async function resolveExistingReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget | null> {
  const existingState = await getExistingYjsState(descriptor.yjsSessionId)
  if (!existingState) {
    return null
  }

  return {
    descriptor,
    runtime: getRuntimeStateFromUpdate(existingState),
  }
}

/**
 * Ensures a review target has an active Yjs document. If an active blob already
 * exists it is reused; workflows can be bootstrapped from normalized workflow
 * tables; saved non-workflow entities require canonical Yjs state and unsaved
 * drafts return the explicit expired state.
 */
export async function bootstrapReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const existing = await resolveExistingReviewTarget(descriptor)
  if (existing) {
    return existing
  }

  if (descriptor.entityKind === 'workflow') {
    return bootstrapWorkflowTarget(descriptor)
  }

  if (descriptor.entityId) {
    throw new ReviewTargetBootstrapError(404, 'Saved entity Yjs state is missing')
  }

  return {
    descriptor,
    runtime: {
      docState: 'expired',
      replaySafe: false,
      reseededFromCanonical: false,
    },
  }
}

async function bootstrapWorkflowTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const workflowId = descriptor.entityId ?? descriptor.yjsSessionId
  if (!workflowId) {
    throw new ReviewTargetBootstrapError(404, 'Workflow target is missing a workflow id')
  }

  const [workflowRow] = await db
    .select({
      id: workflow.id,
      name: workflow.name,
      workspaceId: workflow.workspaceId,
      updatedAt: workflow.updatedAt,
      isDeployed: workflow.isDeployed,
      deployedAt: workflow.deployedAt,
      variables: workflow.variables,
    })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  if (!workflowRow) {
    throw new ReviewTargetBootstrapError(404, 'Workflow target no longer exists')
  }

  const normalizedState = await loadWorkflowFromNormalizedTables(workflowId)
  const workflowSnapshot: WorkflowSnapshot = {
    blocks: normalizedState?.blocks ?? {},
    edges: normalizedState?.edges ?? [],
    loops: normalizedState?.loops ?? {},
    parallels: normalizedState?.parallels ?? {},
    lastSaved: workflowRow.updatedAt?.toISOString(),
    isDeployed: workflowRow.isDeployed,
    deployedAt: workflowRow.deployedAt?.toISOString(),
  }

  const doc = await getBootstrapDoc(workflowId)
  setWorkflowState(doc, workflowSnapshot, 'bootstrap')
  setVariables(
    doc,
    ((workflowRow.variables as Record<string, any> | null) ?? {}) as Record<string, any>,
    'bootstrap'
  )

  doc.transact(() => {
    const metadata = readWorkflowMetadataMap(doc)
    metadata.set('entityName', workflowRow.name)
    metadata.set('reseededFromCanonical', true)
  }, 'bootstrap')

  await persistDoc(workflowId, doc)

  return {
    descriptor: {
      ...descriptor,
      workspaceId: workflowRow.workspaceId ?? descriptor.workspaceId,
      entityId: workflowId,
      yjsSessionId: workflowId,
    },
    runtime: ACTIVE_RESEEDED_RUNTIME,
  }
}
