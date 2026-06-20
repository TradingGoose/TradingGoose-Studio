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
import { getYjsSnapshot, SocketServerBridgeError } from '@/lib/yjs/server/snapshot-bridge'
import { getState as getPersistedYjsState } from '@/socket-server/yjs/persistence'

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
 * exists it is reused. Saved entities require canonical Yjs state; unsaved
 * drafts return the explicit expired state.
 */
export async function bootstrapReviewTarget(
  descriptor: ReviewTargetDescriptor
): Promise<ResolvedReviewTarget> {
  const existing = await resolveExistingReviewTarget(descriptor)
  if (existing) {
    return existing
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
