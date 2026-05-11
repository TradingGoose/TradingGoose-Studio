'use client'

import {
  parseReviewTargetDescriptor,
  serializeReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { normalizeOptionalString } from '@/lib/utils'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import { REVIEW_TARGET_FIELDS } from '@/widgets/events'
import { resolveEntityId } from '@/widgets/widgets/entity_review/resolve-entity-id'

export interface EntitySelectionState {
  selectedEntityId: string | null
  reviewSessionId: string | null
  reviewEntityId: string | null
  reviewDraftSessionId: string | null
  descriptor: ReviewTargetDescriptor | null
}

function readOwnNormalizedString(
  source: Record<string, unknown> | null | undefined,
  key: string
): { found: boolean; value: string | null } {
  if (!source || !Object.hasOwn(source, key)) {
    return { found: false, value: null }
  }

  return {
    found: true,
    value: normalizeOptionalString(source[key]) ?? null,
  }
}

function resolveReviewField(
  key: string,
  options: {
    params?: Record<string, unknown> | null
    pairContext?: PairColorContext | null
  }
): string | null {
  return readOwnNormalizedString(
    options.pairContext ? (options.pairContext as Record<string, unknown>) : options.params,
    key
  ).value
}

export function readReviewTargetDescriptor(options: {
  params?: Record<string, unknown> | null
  pairContext?: PairColorContext | null
}): ReviewTargetDescriptor | null {
  const payload: Record<string, string | undefined> = {
    workspaceId: resolveReviewField('workspaceId', options) ?? undefined,
    yjsSessionId: resolveReviewField('yjsSessionId', options) ?? undefined,
  }
  for (const key of REVIEW_TARGET_FIELDS) {
    payload[key] = resolveReviewField(key, options) ?? undefined
  }

  if (!payload.reviewEntityKind) {
    return null
  }

  try {
    return parseReviewTargetDescriptor(payload)
  } catch {
    return null
  }
}

export function buildReviewTargetDescriptorFromState(options: {
  workspaceId?: string | null
  entityKind?: ReviewEntityKind | string | null
  entityId?: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
}): ReviewTargetDescriptor | null {
  const workspaceId = normalizeOptionalString(options.workspaceId) ?? null
  const entityKind = normalizeOptionalString(options.entityKind) ?? undefined
  const entityId = normalizeOptionalString(options.entityId) ?? undefined
  const draftSessionId = normalizeOptionalString(options.draftSessionId) ?? undefined
  const reviewSessionId = normalizeOptionalString(options.reviewSessionId) ?? undefined

  if (!entityKind || (!entityId && !draftSessionId && !reviewSessionId)) {
    return null
  }

  try {
    return parseReviewTargetDescriptor({
      ...(workspaceId ? { workspaceId } : {}),
      reviewEntityKind: entityKind,
      ...(entityId ? { reviewEntityId: entityId } : {}),
      ...(draftSessionId ? { reviewDraftSessionId: draftSessionId } : {}),
      ...(reviewSessionId ? { reviewSessionId } : {}),
    })
  } catch {
    return null
  }
}

export function readEntitySelectionState(options: {
  params?: Record<string, unknown> | null
  pairContext?: PairColorContext | null
  entityIdKey: keyof PairColorContext | string
}): EntitySelectionState {
  const descriptor = readReviewTargetDescriptor(options)
  const selectedEntityId = resolveEntityId(options.entityIdKey, {
    params: options.params,
    pairContext: options.pairContext as Record<string, unknown> | null | undefined,
  })

  return {
    selectedEntityId: selectedEntityId ?? null,
    reviewSessionId:
      descriptor?.reviewSessionId ?? resolveReviewField('reviewSessionId', options) ?? null,
    reviewEntityId: descriptor?.entityId ?? resolveReviewField('reviewEntityId', options) ?? null,
    reviewDraftSessionId:
      descriptor?.draftSessionId ?? resolveReviewField('reviewDraftSessionId', options) ?? null,
    descriptor,
  }
}

export function buildPersistedReviewParams(options: {
  currentParams?: Record<string, unknown> | null
  entityIdKey: string
  descriptor: ReviewTargetDescriptor | null
  selectedEntityId?: string | null
}): Record<string, unknown> | null {
  const current = Object.fromEntries(
    Object.entries(options.currentParams ?? {}).filter(
      ([key]) =>
        key !== options.entityIdKey &&
        key !== 'yjsSessionId' &&
        !(REVIEW_TARGET_FIELDS as readonly string[]).includes(key)
    )
  )
  const serialized = options.descriptor ? serializeReviewTargetDescriptor(options.descriptor) : {}

  if (options.selectedEntityId) {
    current[options.entityIdKey] = options.selectedEntityId
  }

  Object.assign(current, serialized)

  return Object.keys(current).length > 0 ? current : null
}

export function buildPersistedPairContext(options: {
  existing?: PairColorContext | null
  entityIdKey: keyof PairColorContext
  descriptor: ReviewTargetDescriptor | null
  selectedEntityId?: string | null
}): PairColorContext {
  const next = Object.fromEntries(
    Object.entries(options.existing ?? {}).filter(
      ([key]) =>
        key !== options.entityIdKey && !(REVIEW_TARGET_FIELDS as readonly string[]).includes(key)
    )
  ) as PairColorContext & Record<string, unknown>
  const nextRecord = next as Record<string, unknown>

  if (options.selectedEntityId) {
    nextRecord[options.entityIdKey] = options.selectedEntityId
  }

  if (options.descriptor) {
    next.reviewEntityKind = options.descriptor.entityKind
    if (options.descriptor.reviewSessionId) {
      next.reviewSessionId = options.descriptor.reviewSessionId
    }
    if (options.descriptor.entityId) {
      next.reviewEntityId = options.descriptor.entityId
    }
    if (options.descriptor.draftSessionId) {
      next.reviewDraftSessionId = options.descriptor.draftSessionId
    }
  }

  return next
}

export async function resolveEntityReviewTarget(options: {
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId?: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
}): Promise<ResolvedReviewTarget> {
  const response = await fetch('/api/copilot/review-sessions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: options.workspaceId,
      entityKind: options.entityKind,
      entityId: options.entityId ?? undefined,
      draftSessionId: options.draftSessionId ?? undefined,
      reviewSessionId: options.reviewSessionId ?? undefined,
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve ${options.entityKind} review target`)
  }

  return payload as ResolvedReviewTarget
}
