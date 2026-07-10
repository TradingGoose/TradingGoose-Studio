import { normalizeOptionalString } from '@/lib/utils'
import {
  REVIEW_ENTITY_KINDS,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
  YJS_TARGET_KINDS,
  type YjsTargetKind,
  type YjsTransportEnvelope,
} from './types'

const REVIEW_ENTITY_KIND_SET = new Set<string>(REVIEW_ENTITY_KINDS)
const YJS_TARGET_KIND_SET = new Set<string>(YJS_TARGET_KINDS)
const normalizeNullableString = (value: unknown): string | null =>
  normalizeOptionalString(value) ?? null

function requireCanonicalOwnerScope(
  entityKind: ReviewEntityKind,
  ownerUserId: string | null,
  label: string
): string | null {
  if (entityKind === 'dashboard_layout') {
    if (!ownerUserId) {
      throw new Error(`Dashboard layout ${label} requires ownerUserId`)
    }
    return ownerUserId
  }

  if (ownerUserId) {
    throw new Error(`Shared ${label} cannot carry ownerUserId`)
  }
  return null
}

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
 * Canonical descriptor for a saved entity's own Yjs document (no draft/review
 * session; the Yjs session id is the entity id). The single source of the
 * "saved entity Yjs target" contract, reused by the editor session hook, the
 * server-side field reader, the access check, and the apply route, so every
 * read/write addresses the entity identically.
 */
export function buildSavedEntityDescriptor(
  entityKind: ReviewEntityKind,
  entityId: string,
  workspaceId: string | null,
  options?: { ownerUserId?: string | null }
): ReviewTargetDescriptor {
  const normalizedOwnerUserId = requireCanonicalOwnerScope(
    entityKind,
    normalizeNullableString(options?.ownerUserId ?? null),
    'entity descriptor'
  )
  return {
    workspaceId,
    ownerUserId: normalizedOwnerUserId,
    entityKind,
    entityId,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: entityId,
  }
}

const ENTITY_LIST_SESSION_PREFIX = 'list:'

function buildEntityListSessionId(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): string {
  const normalizedOwnerUserId = requireCanonicalOwnerScope(
    entityKind,
    normalizeNullableString(ownerUserId),
    'list session'
  )
  if (normalizedOwnerUserId) {
    return `${ENTITY_LIST_SESSION_PREFIX}${entityKind}:${workspaceId}:user:${normalizedOwnerUserId}`
  }

  return `${ENTITY_LIST_SESSION_PREFIX}${entityKind}:${workspaceId}`
}

export function isEntityListSessionId(sessionId: string): boolean {
  return sessionId.startsWith(ENTITY_LIST_SESSION_PREFIX)
}

export function buildEntityListDescriptor(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  options?: { ownerUserId?: string | null }
): ReviewTargetDescriptor {
  const normalizedOwnerUserId = requireCanonicalOwnerScope(
    entityKind,
    normalizeNullableString(options?.ownerUserId ?? null),
    'list descriptor'
  )
  return {
    workspaceId,
    ownerUserId: normalizedOwnerUserId,
    entityKind,
    entityId: null,
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: buildEntityListSessionId(entityKind, workspaceId, normalizedOwnerUserId),
  }
}

/**
 * Builds a YjsTransportEnvelope from a ReviewTargetDescriptor.
 */
export function buildYjsTransportEnvelope(
  descriptor: ReviewTargetDescriptor
): YjsTransportEnvelope {
  const targetKind: YjsTargetKind = isEntityListSessionId(descriptor.yjsSessionId)
    ? 'entity_list'
    : descriptor.entityId
      ? 'entity'
      : 'review_session'

  return {
    targetKind,
    sessionId: descriptor.yjsSessionId,
    reviewSessionId: targetKind === 'review_session' ? descriptor.reviewSessionId : null,
    workspaceId: descriptor.workspaceId,
    ownerUserId: descriptor.ownerUserId,
    entityKind: descriptor.entityKind,
    entityId: descriptor.entityId,
    draftSessionId: targetKind === 'review_session' ? descriptor.draftSessionId : null,
  }
}

/**
 * Validates and converts a transport envelope into a ReviewTargetDescriptor.
 */
export function buildReviewTargetDescriptorFromEnvelope(
  envelope: YjsTransportEnvelope
): ReviewTargetDescriptor {
  const ownerUserId = requireCanonicalOwnerScope(
    envelope.entityKind,
    envelope.ownerUserId,
    `${envelope.targetKind} envelope`
  )

  if (envelope.targetKind === 'entity_list') {
    if (!envelope.workspaceId) {
      throw new Error('Entity-list Yjs envelope requires workspaceId')
    }

    if (envelope.entityId || envelope.reviewSessionId || envelope.draftSessionId) {
      throw new Error(
        'Entity-list Yjs envelope cannot carry entityId, reviewSessionId, or draftSessionId'
      )
    }

    const expectedSessionId = buildEntityListSessionId(
      envelope.entityKind,
      envelope.workspaceId,
      ownerUserId
    )
    if (envelope.sessionId !== expectedSessionId) {
      throw new Error(
        'Entity-list Yjs envelope sessionId does not match its workspace and owner scope'
      )
    }

    return {
      workspaceId: envelope.workspaceId,
      ownerUserId,
      entityKind: envelope.entityKind,
      entityId: null,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: envelope.sessionId,
    }
  }

  if (envelope.targetKind === 'entity') {
    if (envelope.entityKind !== 'workflow' && !envelope.workspaceId) {
      throw new Error('Entity Yjs envelope requires workspaceId')
    }

    if (!envelope.entityId) {
      throw new Error('Entity Yjs envelope requires entityId')
    }

    if (envelope.sessionId !== envelope.entityId) {
      throw new Error('Entity Yjs envelope sessionId must equal entityId')
    }

    if (envelope.reviewSessionId || envelope.draftSessionId) {
      throw new Error('Entity Yjs envelope cannot carry reviewSessionId or draftSessionId')
    }

    return {
      workspaceId: envelope.workspaceId ?? null,
      ownerUserId,
      entityKind: envelope.entityKind,
      entityId: envelope.entityId,
      draftSessionId: null,
      reviewSessionId: null,
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

  if (!envelope.workspaceId) {
    throw new Error('Review-session Yjs envelope requires workspaceId')
  }

  if (envelope.entityId) {
    throw new Error('Review-session Yjs envelope cannot carry entityId')
  }

  if (!envelope.draftSessionId) {
    throw new Error('Review-session Yjs envelope requires draftSessionId')
  }

  return {
    workspaceId: envelope.workspaceId,
    ownerUserId,
    entityKind: envelope.entityKind,
    entityId: envelope.entityId,
    draftSessionId: envelope.draftSessionId,
    reviewSessionId,
    yjsSessionId: envelope.sessionId,
  }
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

  if (envelope.reviewSessionId != null) result.reviewSessionId = envelope.reviewSessionId
  if (envelope.workspaceId != null) result.workspaceId = envelope.workspaceId
  if (envelope.ownerUserId != null) result.ownerUserId = envelope.ownerUserId
  if (envelope.entityId != null) result.entityId = envelope.entityId
  if (envelope.draftSessionId != null) result.draftSessionId = envelope.draftSessionId

  return result
}

/**
 * Parses a flat serialized record back into a YjsTransportEnvelope.
 */
export function parseYjsTransportEnvelope(
  payload: Record<string, string | undefined>
): YjsTransportEnvelope {
  if (normalizeNullableString(payload.workflowId)) {
    throw new Error('Yjs transport envelope cannot carry workflowId; use entityId')
  }

  const envelope: YjsTransportEnvelope = {
    targetKind: requireYjsTargetKind(payload.targetKind),
    sessionId:
      normalizeOptionalString(payload.sessionId) ??
      (() => {
        throw new Error('Missing required transport envelope field: sessionId')
      })(),
    reviewSessionId: normalizeNullableString(payload.reviewSessionId),
    workspaceId: normalizeNullableString(payload.workspaceId),
    ownerUserId: normalizeNullableString(payload.ownerUserId),
    entityKind: requireReviewEntityKind(payload.entityKind),
    entityId: normalizeNullableString(payload.entityId),
    draftSessionId: normalizeNullableString(payload.draftSessionId),
  }

  buildReviewTargetDescriptorFromEnvelope(envelope)
  return envelope
}
