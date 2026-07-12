import { normalizeOptionalString } from '@/lib/utils'
import {
  REVIEW_ENTITY_KINDS,
  type ReviewEntityKind,
  type ReviewTargetDescriptor,
  YJS_DOCUMENT_KINDS,
  YJS_TARGET_KINDS,
  type YjsDocumentKind,
  type YjsTargetKind,
  type YjsTransportEnvelope,
} from './types'

const REVIEW_ENTITY_KIND_SET = new Set<string>(REVIEW_ENTITY_KINDS)
const YJS_DOCUMENT_KIND_SET = new Set<string>(YJS_DOCUMENT_KINDS)
const YJS_TARGET_KIND_SET = new Set<string>(YJS_TARGET_KINDS)
const normalizeNullableString = (value: unknown): string | null =>
  normalizeOptionalString(value) ?? null

function requireCanonicalOwnerScope(
  entityKind: YjsDocumentKind,
  ownerUserId: string | null,
  label: string
): string | null {
  if (
    entityKind === 'dashboard_layout' ||
    entityKind === 'dashboard_widget' ||
    entityKind === 'dashboard_color_pair'
  ) {
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

const requireYjsDocumentKind = (value: string | undefined): YjsDocumentKind => {
  const normalized = normalizeOptionalString(value)
  if (!normalized || !YJS_DOCUMENT_KIND_SET.has(normalized)) {
    throw new Error('Invalid or missing Yjs document kind')
  }
  return normalized as YjsDocumentKind
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

const DASHBOARD_WIDGET_SESSION_PREFIX = 'dashboard-widget:'
const DASHBOARD_COLOR_PAIR_SESSION_PREFIX = 'dashboard-color-pair:'

const requireSessionPart = (value: string, label: string) => {
  const normalized = normalizeOptionalString(value)
  if (!normalized || normalized.includes(':')) {
    throw new Error(`${label} must be a non-empty value without colons`)
  }
  return normalized
}

export function buildDashboardWidgetSessionId(layoutId: string, identityId: string): string {
  return `${DASHBOARD_WIDGET_SESSION_PREFIX}${requireSessionPart(layoutId, 'layoutId')}:${requireSessionPart(identityId, 'identityId')}`
}

export function parseDashboardWidgetSessionId(
  sessionId: string
): { layoutId: string; identityId: string } | null {
  if (!sessionId.startsWith(DASHBOARD_WIDGET_SESSION_PREFIX)) return null
  const [layoutId, identityId, extra] = sessionId
    .slice(DASHBOARD_WIDGET_SESSION_PREFIX.length)
    .split(':')
  return layoutId && identityId && extra === undefined ? { layoutId, identityId } : null
}

export function buildDashboardColorPairSessionId(layoutId: string, color: string): string {
  return `${DASHBOARD_COLOR_PAIR_SESSION_PREFIX}${requireSessionPart(layoutId, 'layoutId')}:${requireSessionPart(color, 'color')}`
}

export function parseDashboardColorPairSessionId(
  sessionId: string
): { layoutId: string; color: string } | null {
  if (!sessionId.startsWith(DASHBOARD_COLOR_PAIR_SESSION_PREFIX)) return null
  const [layoutId, color, extra] = sessionId
    .slice(DASHBOARD_COLOR_PAIR_SESSION_PREFIX.length)
    .split(':')
  return layoutId && color && extra === undefined ? { layoutId, color } : null
}

export function buildDashboardWidgetDescriptor(input: {
  layoutId: string
  identityId: string
  workspaceId: string
  ownerUserId: string
}): ReviewTargetDescriptor {
  return {
    workspaceId: input.workspaceId,
    ownerUserId: requireCanonicalOwnerScope(
      'dashboard_widget',
      normalizeNullableString(input.ownerUserId),
      'widget descriptor'
    ),
    entityKind: 'dashboard_widget',
    entityId: requireSessionPart(input.identityId, 'identityId'),
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: buildDashboardWidgetSessionId(input.layoutId, input.identityId),
  }
}

export function buildDashboardColorPairDescriptor(input: {
  layoutId: string
  color: string
  workspaceId: string
  ownerUserId: string
}): ReviewTargetDescriptor {
  return {
    workspaceId: input.workspaceId,
    ownerUserId: requireCanonicalOwnerScope(
      'dashboard_color_pair',
      normalizeNullableString(input.ownerUserId),
      'color-pair descriptor'
    ),
    entityKind: 'dashboard_color_pair',
    entityId: requireSessionPart(input.color, 'color'),
    draftSessionId: null,
    reviewSessionId: null,
    yjsSessionId: buildDashboardColorPairSessionId(input.layoutId, input.color),
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
    ownerUserId: descriptor.ownerUserId ?? null,
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
    const entityKind = requireReviewEntityKind(envelope.entityKind)
    if (!envelope.workspaceId) {
      throw new Error('Entity-list Yjs envelope requires workspaceId')
    }

    if (envelope.entityId || envelope.reviewSessionId || envelope.draftSessionId) {
      throw new Error(
        'Entity-list Yjs envelope cannot carry entityId, reviewSessionId, or draftSessionId'
      )
    }

    const expectedSessionId = buildEntityListSessionId(
      entityKind,
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
      entityKind,
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

    if (envelope.entityKind === 'dashboard_widget') {
      const target = parseDashboardWidgetSessionId(envelope.sessionId)
      if (!target || target.identityId !== envelope.entityId) {
        throw new Error('Dashboard widget Yjs envelope has an invalid session identity')
      }
    } else if (envelope.entityKind === 'dashboard_color_pair') {
      const target = parseDashboardColorPairSessionId(envelope.sessionId)
      if (!target || target.color !== envelope.entityId) {
        throw new Error('Dashboard color-pair Yjs envelope has an invalid session identity')
      }
    } else if (envelope.sessionId !== envelope.entityId) {
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

  const entityKind = requireReviewEntityKind(envelope.entityKind)

  if (entityKind === 'workflow') {
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
    entityKind,
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
    entityKind: requireYjsDocumentKind(payload.entityKind),
    entityId: normalizeNullableString(payload.entityId),
    draftSessionId: normalizeNullableString(payload.draftSessionId),
  }

  buildReviewTargetDescriptorFromEnvelope(envelope)
  return envelope
}
