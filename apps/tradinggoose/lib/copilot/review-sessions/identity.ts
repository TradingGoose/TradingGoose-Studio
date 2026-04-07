import {
  REVIEW_ENTITY_KINDS,
  YJS_TARGET_KINDS,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
  type YjsTargetKind,
  type YjsTransportEnvelope,
} from './types'
import { normalizeOptionalString } from '@/lib/utils'

const REVIEW_ENTITY_KIND_SET = new Set<string>(REVIEW_ENTITY_KINDS)
const YJS_TARGET_KIND_SET = new Set<string>(YJS_TARGET_KINDS)
const normalizeNullableString = (value: unknown): string | null =>
  normalizeOptionalString(value) ?? null

const requireReviewEntityKind = (value: string | undefined): ReviewEntityKind => {
  const normalized = normalizeOptionalString(value)
  if (!normalized || !REVIEW_ENTITY_KIND_SET.has(normalized)) {
    throw new Error('Invalid or missing review entity kind')
  }

  return normalized as ReviewEntityKind
}

const requireYjsTargetKind = (value: string | undefined): YjsTargetKind => {
  const normalized = normalizeOptionalString(value)
  if (!normalized || !YJS_TARGET_KIND_SET.has(normalized)) {
    throw new Error('Invalid or missing Yjs target kind')
  }

  return normalized as YjsTargetKind
}

/**
 * Derives the Yjs document session id from a review target.
 * - Workflow mode: yjsSessionId = workflowId (shared across all users/threads)
 * - Entity review mode: yjsSessionId = reviewSessionId
 *
 * Saved entities still collaborate across workspace users because they resolve
 * to the same reviewSession row, and drafts stay user-owned because their
 * reviewSession rows remain user-scoped until first save.
 */
export function deriveYjsSessionId(reviewTarget: {
  entityKind: ReviewEntityKind
  entityId: string | null
  reviewSessionId: string | null
}): string {
  if (reviewTarget.entityKind === 'workflow') {
    if (!reviewTarget.entityId) {
      throw new Error('Workflow review target requires entityId (workflowId)')
    }
    return reviewTarget.entityId
  }

  if (!reviewTarget.reviewSessionId) {
    throw new Error('Entity review target requires reviewSessionId')
  }

  return reviewTarget.reviewSessionId
}

/**
 * Builds a full ReviewTargetDescriptor from a review session database row.
 */
export function buildReviewTargetDescriptor(reviewSessionRow: {
  id: string
  workspaceId: string | null
  entityKind: string
  entityId: string | null
  draftSessionId: string | null
}): ReviewTargetDescriptor {
  const entityKind = requireReviewEntityKind(reviewSessionRow.entityKind)
  const reviewSessionId = reviewSessionRow.id

  return {
    workspaceId: reviewSessionRow.workspaceId,
    entityKind,
    entityId: reviewSessionRow.entityId,
    draftSessionId: reviewSessionRow.draftSessionId,
    reviewSessionId,
    yjsSessionId: deriveYjsSessionId({
      entityKind,
      entityId: reviewSessionRow.entityId,
      reviewSessionId,
    }),
  }
}

/**
 * Builds a YjsTransportEnvelope from a ReviewTargetDescriptor.
 */
export function buildYjsTransportEnvelope(
  descriptor: ReviewTargetDescriptor
): YjsTransportEnvelope {
  const targetKind: YjsTargetKind =
    descriptor.entityKind === 'workflow' ? 'workflow' : 'review_session'

  return {
    targetKind,
    sessionId: descriptor.yjsSessionId,
    workflowId: descriptor.entityKind === 'workflow' ? descriptor.entityId : null,
    reviewSessionId: descriptor.reviewSessionId,
    workspaceId: descriptor.workspaceId,
    entityKind: descriptor.entityKind,
    entityId: descriptor.entityId,
    draftSessionId: descriptor.draftSessionId,
  }
}

/**
 * Validates and converts a transport envelope into a ReviewTargetDescriptor.
 */
export function buildReviewTargetDescriptorFromEnvelope(
  envelope: YjsTransportEnvelope
): ReviewTargetDescriptor {
  if (envelope.targetKind === 'workflow') {
    if (envelope.entityKind !== 'workflow') {
      throw new Error('Workflow Yjs envelope must use entityKind="workflow"')
    }

    const workflowId = envelope.workflowId ?? envelope.entityId ?? envelope.sessionId
    if (!workflowId) {
      throw new Error('Workflow Yjs envelope requires a workflowId')
    }

    if (envelope.sessionId !== workflowId) {
      throw new Error('Workflow Yjs envelope sessionId must equal workflowId')
    }

    if (envelope.entityId && envelope.entityId !== workflowId) {
      throw new Error('Workflow Yjs envelope entityId must equal workflowId')
    }

    if (envelope.draftSessionId) {
      throw new Error('Workflow Yjs envelope cannot carry draftSessionId')
    }

    return {
      workspaceId: envelope.workspaceId ?? null,
      entityKind: 'workflow',
      entityId: workflowId,
      draftSessionId: null,
      reviewSessionId: envelope.reviewSessionId ?? null,
      yjsSessionId: envelope.sessionId,
    }
  }

  if (envelope.entityKind === 'workflow') {
    throw new Error('Review-session Yjs envelope cannot use entityKind="workflow"')
  }

  const reviewSessionId = envelope.reviewSessionId ?? envelope.sessionId
  if (!reviewSessionId) {
    throw new Error('Review-session Yjs envelope requires reviewSessionId')
  }

  if (envelope.sessionId !== reviewSessionId) {
    throw new Error('Review-session Yjs envelope sessionId must equal reviewSessionId')
  }

  if (envelope.workflowId) {
    throw new Error('Review-session Yjs envelope cannot carry workflowId')
  }

  if (!envelope.workspaceId) {
    throw new Error('Review-session Yjs envelope requires workspaceId')
  }

  if (!envelope.entityId && !envelope.draftSessionId) {
    throw new Error('Review-session Yjs envelope requires entityId or draftSessionId')
  }

  return {
    workspaceId: envelope.workspaceId,
    entityKind: envelope.entityKind,
    entityId: envelope.entityId,
    draftSessionId: envelope.draftSessionId,
    reviewSessionId,
    yjsSessionId: envelope.sessionId,
  }
}

/**
 * Serializes a ReviewTargetDescriptor into a flat key/value record
 * suitable for persisting in widget params, pair state, and query strings.
 */
export function serializeReviewTargetDescriptor(
  descriptor: ReviewTargetDescriptor
): Record<string, string> {
  const result: Record<string, string> = {
    reviewEntityKind: descriptor.entityKind,
    yjsSessionId: descriptor.yjsSessionId,
  }

  if (descriptor.workspaceId != null) result.workspaceId = descriptor.workspaceId
  if (descriptor.entityId != null) result.reviewEntityId = descriptor.entityId
  if (descriptor.draftSessionId != null) result.reviewDraftSessionId = descriptor.draftSessionId
  if (descriptor.reviewSessionId != null) result.reviewSessionId = descriptor.reviewSessionId

  return result
}

/**
 * Serializes a YjsTransportEnvelope into a flat key/value record
 * suitable for websocket query params and snapshot query strings.
 */
export function serializeYjsTransportEnvelope(
  envelope: YjsTransportEnvelope
): Record<string, string> {
  const result: Record<string, string> = {
    targetKind: envelope.targetKind,
    sessionId: envelope.sessionId,
    entityKind: envelope.entityKind,
  }

  if (envelope.workflowId != null) result.workflowId = envelope.workflowId
  if (envelope.reviewSessionId != null) result.reviewSessionId = envelope.reviewSessionId
  if (envelope.workspaceId != null) result.workspaceId = envelope.workspaceId
  if (envelope.entityId != null) result.entityId = envelope.entityId
  if (envelope.draftSessionId != null) result.draftSessionId = envelope.draftSessionId

  return result
}

/**
 * Parses a flat serialized record back into a ReviewTargetDescriptor.
 */
export function parseReviewTargetDescriptor(
  payload: Record<string, string | undefined>
): ReviewTargetDescriptor {
  const entityKind = requireReviewEntityKind(payload.reviewEntityKind)
  const reviewSessionId = normalizeNullableString(payload.reviewSessionId)
  const entityId = normalizeNullableString(payload.reviewEntityId)
  const draftSessionId = normalizeNullableString(payload.reviewDraftSessionId)
  const derivedYjsSessionId = deriveYjsSessionId({ entityKind, entityId, reviewSessionId })
  const serializedYjsSessionId = normalizeOptionalString(payload.yjsSessionId)
  const yjsSessionId =
    serializedYjsSessionId === derivedYjsSessionId
      ? serializedYjsSessionId
      : derivedYjsSessionId

  return {
    workspaceId: normalizeNullableString(payload.workspaceId),
    entityKind,
    entityId,
    draftSessionId,
    reviewSessionId,
    yjsSessionId,
  }
}

/**
 * Parses a flat serialized record back into a YjsTransportEnvelope.
 */
export function parseYjsTransportEnvelope(
  payload: Record<string, string | undefined>
): YjsTransportEnvelope {
  const envelope: YjsTransportEnvelope = {
    targetKind: requireYjsTargetKind(payload.targetKind),
    sessionId:
      normalizeOptionalString(payload.sessionId) ??
      (() => {
        throw new Error('Missing required transport envelope field: sessionId')
      })(),
    workflowId: normalizeNullableString(payload.workflowId),
    reviewSessionId: normalizeNullableString(payload.reviewSessionId),
    workspaceId: normalizeNullableString(payload.workspaceId),
    entityKind: requireReviewEntityKind(payload.entityKind),
    entityId: normalizeNullableString(payload.entityId),
    draftSessionId: normalizeNullableString(payload.draftSessionId),
  }

  buildReviewTargetDescriptorFromEnvelope(envelope)
  return envelope
}
