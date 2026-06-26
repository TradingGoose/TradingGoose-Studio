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
import { loadWorkflowBootstrapStateFromDb } from '@/lib/workflows/db-helpers'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import {
  readSavedEntityFieldsFromDb,
  resolveEntityWorkspaceId,
} from '@/lib/yjs/server/entity-loaders'
import { getYjsSnapshot } from '@/lib/yjs/server/snapshot-bridge'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  createWorkflowSnapshot,
  getMetadataMap,
  setVariables,
  setWorkflowState,
} from '@/lib/yjs/workflow-session'

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
  return getYjsSnapshot(descriptor.yjsSessionId, bridgeParams)
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

export async function createSavedReviewTargetBootstrapUpdate(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget & { state: Uint8Array }> {
  if (!descriptor.entityId) {
    throw new ReviewTargetBootstrapError(404, 'Saved entity id is required')
  }

  const doc = new Y.Doc()
  try {
    let workflowName: string | null | undefined
    let workflowDescription: string | null | undefined
    let workflowFolderId: string | null | undefined
    let resolvedWorkspaceId: string | null = descriptor.workspaceId
    if (descriptor.entityKind === 'workflow') {
      const workflowState = await loadWorkflowBootstrapStateFromDb(descriptor.entityId)
      if (!workflowState) {
        throw new ReviewTargetBootstrapError(404, 'Workflow not found')
      }
      workflowName = workflowState.name
      workflowDescription = workflowState.description
      workflowFolderId = workflowState.folderId

      setWorkflowState(
        doc,
        createWorkflowSnapshot({
          direction: workflowState.direction,
          blocks: workflowState.blocks,
          edges: workflowState.edges,
          loops: workflowState.loops,
          parallels: workflowState.parallels,
          lastSaved: new Date(workflowState.lastSaved).toISOString(),
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
      resolvedWorkspaceId = workspaceId

      seedEntitySession(doc, {
        entityKind,
        payload: await readSavedEntityFieldsFromDb(entityKind, descriptor.entityId, workspaceId),
      })
    }

    const metadata = getMetadataMap(doc)
    metadata.set('bootstrap-touch', Date.now())
    metadata.set('entityKind', descriptor.entityKind)
    metadata.set('entityId', descriptor.entityId)
    metadata.set('workspaceId', resolvedWorkspaceId)
    metadata.set('draftSessionId', descriptor.draftSessionId)
    metadata.set('reviewSessionId', descriptor.reviewSessionId)
    metadata.set('reseededFromCanonical', true)
    if (workflowName) {
      metadata.set('entityName', workflowName)
    }
    if (workflowDescription !== undefined) {
      metadata.set('entityDescription', workflowDescription)
    }
    if (workflowFolderId !== undefined) {
      metadata.set('folderId', workflowFolderId)
    }
    const state = Y.encodeStateAsUpdate(doc)

    return {
      descriptor,
      runtime: getRuntimeStateFromUpdate(state),
      state,
    }
  } finally {
    doc.destroy()
  }
}
