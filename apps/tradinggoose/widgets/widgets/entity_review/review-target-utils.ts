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
import type { PairColorContext, PairReviewTarget } from '@/stores/dashboard/pair-store'
import { REVIEW_TARGET_FIELDS } from '@/widgets/events'
import { resolveEntityId } from '@/widgets/widgets/entity_review/resolve-entity-id'

export interface EntitySelectionState {
  legacyEntityId: string | null
  reviewSessionId: string | null
  reviewEntityId: string | null
  reviewDraftSessionId: string | null
  descriptor: ReviewTargetDescriptor | null
}

function getNestedReviewTarget(
  pairContext?: PairColorContext | null
): Record<string, unknown> | null {
  if (!pairContext || typeof pairContext !== 'object') {
    return null
  }

  const reviewTarget = pairContext.reviewTarget
  if (!reviewTarget || typeof reviewTarget !== 'object') {
    return null
  }

  return reviewTarget as Record<string, unknown>
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
  const nestedPairTarget = readOwnNormalizedString(getNestedReviewTarget(options.pairContext), key)
  if (nestedPairTarget.found) {
    return nestedPairTarget.value
  }

  const pairField = readOwnNormalizedString(options.pairContext as Record<string, unknown> | null, key)
  if (pairField.found) {
    return pairField.value
  }

  return readOwnNormalizedString(options.params ?? null, key).value
}

export function readReviewTargetDescriptor(options: {
  params?: Record<string, unknown> | null
  pairContext?: PairColorContext | null
}): ReviewTargetDescriptor | null {
  const payload: Record<string, string | undefined> = {
    workspaceId:
      resolveReviewField('workspaceId', options) ?? undefined,
    yjsSessionId:
      resolveReviewField('yjsSessionId', options) ?? undefined,
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

export function readEntitySelectionState(options: {
  params?: Record<string, unknown> | null
  pairContext?: PairColorContext | null
  legacyIdKey: keyof PairColorContext | string
}): EntitySelectionState {
  const descriptor = readReviewTargetDescriptor(options)
  const rawLegacyValue = resolveEntityId(options.legacyIdKey, {
    params: options.params,
    pairContext: options.pairContext as Record<string, unknown> | null | undefined,
  })

  return {
    legacyEntityId: rawLegacyValue ?? null,
    reviewSessionId:
      descriptor?.reviewSessionId ??
      resolveReviewField('reviewSessionId', options) ??
      null,
    reviewEntityId:
      descriptor?.entityId ??
      resolveReviewField('reviewEntityId', options) ??
      null,
    reviewDraftSessionId:
      descriptor?.draftSessionId ??
      resolveReviewField('reviewDraftSessionId', options) ??
      null,
    descriptor,
  }
}

export function buildPersistedReviewParams(options: {
  currentParams?: Record<string, unknown> | null
  legacyIdKey: string
  descriptor: ReviewTargetDescriptor | null
  legacyEntityId?: string | null
}): Record<string, unknown> | null {
  const current = { ...(options.currentParams ?? {}) }
  const serialized = options.descriptor ? serializeReviewTargetDescriptor(options.descriptor) : {}

  if (options.legacyEntityId) {
    current[options.legacyIdKey] = options.legacyEntityId
  } else {
    delete current[options.legacyIdKey]
  }

  delete current.reviewSessionId
  delete current.reviewEntityKind
  delete current.reviewEntityId
  delete current.reviewDraftSessionId
  delete current.yjsSessionId

  Object.assign(current, serialized)

  return Object.keys(current).length > 0 ? current : null
}

export function buildPersistedPairContext(options: {
  existing?: PairColorContext | null
  legacyIdKey: keyof PairColorContext
  descriptor: ReviewTargetDescriptor | null
  legacyEntityId?: string | null
}): PairColorContext {
  const next = {
    ...(options.existing ?? {}),
  } as PairColorContext & Record<string, unknown>

  if (options.legacyEntityId) {
    ;(next as Record<string, unknown>)[options.legacyIdKey] = options.legacyEntityId
  } else {
    delete (next as Record<string, unknown>)[options.legacyIdKey]
  }

  delete next.reviewTarget

  if (options.descriptor) {
    const serialized = serializeReviewTargetDescriptor(options.descriptor)
    next.reviewTarget = {
      reviewSessionId: serialized.reviewSessionId ?? null,
      reviewEntityKind: serialized.reviewEntityKind ?? null,
      reviewEntityId: serialized.reviewEntityId ?? null,
      reviewDraftSessionId: serialized.reviewDraftSessionId ?? null,
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
