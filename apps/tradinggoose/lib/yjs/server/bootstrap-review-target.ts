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
import { loadWorkflowStateFromSavedTables, readWorkflowUpdatedAt } from '@/lib/workflows/db-helpers'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import {
  readSavedEntityFieldsFromDb,
  readSavedEntityUpdatedAt,
  resolveEntityWorkspaceId,
} from '@/lib/yjs/server/entity-loaders'
import {
  deleteYjsSessionInSocketServer,
  getYjsSnapshot,
  SocketServerBridgeError,
  type YjsSnapshotResponse,
} from '@/lib/yjs/server/snapshot-bridge'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createWorkflowSnapshot,
  getMetadataMap,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'
import {
  getState as getPersistedYjsState,
  storeCanonicalState,
  storeState,
} from '@/socket-server/yjs/persistence'

export class ReviewTargetBootstrapError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ReviewTargetBootstrapError'
    this.status = status
  }
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
    const snapshot = await getYjsSnapshot(descriptor.yjsSessionId, bridgeParams)
    if (await isSavedTargetSnapshotFresh(descriptor, snapshot)) {
      return snapshot
    }
    await deleteYjsSessionInSocketServer(descriptor.yjsSessionId)
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

async function isSavedTargetSnapshotFresh(
  descriptor: ReviewTargetDescriptor,
  snapshot: YjsSnapshotResponse
): Promise<boolean> {
  if (descriptor.reviewSessionId || !descriptor.entityId) {
    return true
  }

  const savedAt =
    descriptor.entityKind === 'workflow'
      ? await readWorkflowUpdatedAt(descriptor.entityId)
      : await readSavedEntityUpdatedAt(
          descriptor.entityKind as SavedEntityKind,
          descriptor.entityId
        )
  return Boolean(
    savedAt && typeof snapshot.touchedAt === 'number' && snapshot.touchedAt >= savedAt.getTime()
  )
}

export async function readBootstrappedSavedEntityFields(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  const snapshot = await readBootstrappedReviewTargetSnapshot({
    workspaceId,
    entityKind,
    entityId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: entityId,
  })
  if (!snapshot.snapshotBase64) {
    throw new ReviewTargetBootstrapError(404, `Saved ${entityKind} ${entityId} state is missing`)
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return getEntityFields(doc, entityKind)
  } finally {
    doc.destroy()
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

async function bootstrapSavedEntityFromDb(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  if (!descriptor.entityId) {
    throw new ReviewTargetBootstrapError(404, 'Saved entity id is required')
  }

  const doc = new Y.Doc()
  try {
    let workflowName: string | null | undefined
    if (descriptor.entityKind === 'workflow') {
      const workflowState = await loadWorkflowStateFromSavedTables(descriptor.entityId)
      if (!workflowState) {
        throw new ReviewTargetBootstrapError(404, 'Workflow not found')
      }
      workflowName = workflowState.name

      setWorkflowState(
        doc,
        createWorkflowSnapshot({
          direction: workflowState.direction,
          blocks: workflowState.blocks,
          edges: workflowState.edges,
          loops: workflowState.loops,
          parallels: workflowState.parallels,
          lastSaved: new Date(workflowState.lastSaved).toISOString(),
          isDeployed: workflowState.isDeployed,
          deployedAt: workflowState.deployedAt,
        }),
        YJS_ORIGINS.SYSTEM
      )
      setVariables(doc, workflowState.variables, YJS_ORIGINS.SYSTEM)
    } else {
      const entityKind = descriptor.entityKind as SavedEntityKind
      const workspaceId =
        descriptor.workspaceId ?? (await resolveEntityWorkspaceId(entityKind, descriptor.entityId))
      if (!workspaceId) {
        throw new ReviewTargetBootstrapError(404, 'Saved entity workspace is missing')
      }

      seedEntitySession(doc, {
        entityKind,
        payload: await readSavedEntityFieldsFromDb(entityKind, descriptor.entityId, workspaceId),
      })
    }

    const metadata = getMetadataMap(doc)
    metadata.set('bootstrap-touch', Date.now())
    metadata.set('reseededFromCanonical', true)
    if (workflowName) {
      metadata.set('entityName', workflowName)
    }
    const state = Y.encodeStateAsUpdate(doc)
    await (descriptor.entityKind === 'workflow' ? storeCanonicalState : storeState)(
      descriptor.yjsSessionId,
      state
    )

    return {
      descriptor,
      runtime: getRuntimeStateFromUpdate(state),
    }
  } finally {
    doc.destroy()
  }
}

/**
 * Ensures a review target has an active Yjs document. If an active blob already
 * exists it is reused. Saved entities start a Yjs editing session from the
 * saved database state; unsaved drafts return the explicit expired state.
 */
export async function bootstrapReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const existing = await resolveExistingReviewTarget(descriptor)
  if (existing) {
    return existing
  }

  if (descriptor.entityId) {
    return bootstrapSavedEntityFromDb(descriptor)
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
