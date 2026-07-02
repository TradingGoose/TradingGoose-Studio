import * as Y from 'yjs'
import {
  buildEntityListDescriptor,
  buildSavedEntityDescriptor,
  buildYjsTransportEnvelope,
  serializeYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
  ReviewTargetDescriptor,
  ReviewTargetRuntimeState,
} from '@/lib/copilot/review-sessions/types'
import { loadWorkflowBootstrapStateFromDb } from '@/lib/workflows/db-helpers'
import {
  type EntityListMember,
  getEntityFields,
  getEntityListMembers,
  replaceEntityListSessionMembers,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import { type SavedEntityKind, SavedEntityRealtimeRequiredError } from '@/lib/yjs/entity-state'
import {
  readEntityListMembersFromDb,
  readSavedEntityFieldsFromDb,
  resolveEntityWorkspaceId,
} from '@/lib/yjs/server/entity-loaders'
import { getYjsSnapshot, SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'
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

const entityListReseedQueues = new WeakMap<Y.Doc, Promise<void>>()

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

function mapSavedEntitySnapshotError(error: unknown): never {
  if (error instanceof SocketServerBridgeError && error.status < 500) {
    throw new ReviewTargetBootstrapError(error.status, error.message)
  }
  throw new SavedEntityRealtimeRequiredError()
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: number }).status === 404
  )
}

export async function readBootstrappedReviewTargetSnapshot(descriptor: ReviewTargetDescriptor) {
  const bridgeParams = serializeYjsTransportEnvelope(buildYjsTransportEnvelope(descriptor))
  return getYjsSnapshot(descriptor.yjsSessionId, bridgeParams)
}

/**
 * The snapshot route reseeds live entity-list docs from canonical DB rows
 * before serving (socket-server/routes/http.ts), so this read is DB-fresh:
 * members from a stale live doc — e.g. after a failed refresh whose discard
 * also failed — cannot reach it.
 */
export async function requireEntityRealtimeListMembers(
  entityKind: ReviewEntityKind,
  workspaceId: string
): Promise<EntityListMember[]> {
  const snapshot = await readBootstrappedReviewTargetSnapshot(
    buildEntityListDescriptor(entityKind, workspaceId)
  ).catch(mapSavedEntitySnapshotError)
  if (!snapshot.snapshotBase64) {
    return []
  }

  const doc = new Y.Doc()
  try {
    Y.applyUpdate(doc, Buffer.from(snapshot.snapshotBase64, 'base64'))
    return getEntityListMembers(doc)
  } finally {
    doc.destroy()
  }
}

async function readLiveSavedEntityListFieldsForExecution(
  entityKind: SavedEntityKind,
  workspaceId: string
): Promise<Array<EntityListMember & { fields: Record<string, unknown> }>> {
  const members = await requireEntityRealtimeListMembers(entityKind, workspaceId)
  const entries = await Promise.all(
    members.map(async (member) => {
      try {
        return {
          ...member,
          fields: await readBootstrappedSavedEntityFields(entityKind, member.entityId, workspaceId),
        }
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    })
  )

  return entries.filter(
    (entry): entry is EntityListMember & { fields: Record<string, unknown> } => entry !== null
  )
}

export async function readSavedEntityFieldsForExecution(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string,
  isDeployedContext: boolean
): Promise<Record<string, unknown>> {
  return isDeployedContext
    ? readSavedEntityFieldsFromDb(entityKind, entityId, workspaceId)
    : readBootstrappedSavedEntityFields(entityKind, entityId, workspaceId)
}

export async function readSavedEntityListFieldsForExecution(
  entityKind: SavedEntityKind,
  workspaceId: string,
  isDeployedContext: boolean
): Promise<Array<EntityListMember & { fields: Record<string, unknown> }>> {
  if (!isDeployedContext) {
    return readLiveSavedEntityListFieldsForExecution(entityKind, workspaceId)
  }

  const members = await readEntityListMembersFromDb(entityKind, workspaceId)
  const entries = await Promise.all(
    members.map(async (member) => {
      try {
        return {
          entityId: member.id,
          entityName: member.name,
          ...(typeof member.enabled === 'boolean' ? { enabled: member.enabled } : {}),
          ...('folderId' in member ? { folderId: member.folderId ?? null } : {}),
          ...(typeof member.color === 'string' ? { color: member.color } : {}),
          fields: await readSavedEntityFieldsFromDb(entityKind, member.id, workspaceId),
        }
      } catch (error) {
        if (isNotFoundError(error)) return null
        throw error
      }
    })
  )

  return entries.filter(
    (entry): entry is EntityListMember & { fields: Record<string, unknown> } => entry !== null
  )
}

export async function readBootstrappedSavedEntityFields(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  const snapshot = await readBootstrappedReviewTargetSnapshot(
    buildSavedEntityDescriptor(entityKind, entityId, workspaceId)
  ).catch(mapSavedEntitySnapshotError)
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
    let resolvedWorkspaceId: string | null = descriptor.workspaceId
    if (descriptor.entityKind === 'workflow') {
      const workflowState = await loadWorkflowBootstrapStateFromDb(descriptor.entityId)
      if (!workflowState) {
        throw new ReviewTargetBootstrapError(404, 'Workflow not found')
      }

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

export async function createEntityListBootstrapUpdate(
  entityKind: ReviewEntityKind,
  workspaceId: string
): Promise<ResolvedReviewTarget & { state: Uint8Array }> {
  const descriptor = buildEntityListDescriptor(entityKind, workspaceId)
  const doc = new Y.Doc()
  try {
    replaceEntityListSessionMembers(
      doc,
      await readEntityListMembersFromDb(entityKind, workspaceId)
    )

    const metadata = getMetadataMap(doc)
    metadata.set('reseededFromCanonical', true)
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

export async function reseedEntityListSessionFromDb(
  doc: Y.Doc,
  entityKind: ReviewEntityKind,
  workspaceId: string
): Promise<void> {
  const previous = entityListReseedQueues.get(doc) ?? Promise.resolve()
  const reseed = previous
    .catch(() => undefined)
    .then(async () => {
      replaceEntityListSessionMembers(
        doc,
        await readEntityListMembersFromDb(entityKind, workspaceId)
      )
    })
  entityListReseedQueues.set(doc, reseed)
  try {
    await reseed
  } finally {
    if (entityListReseedQueues.get(doc) === reseed) {
      entityListReseedQueues.delete(doc)
    }
  }
}
