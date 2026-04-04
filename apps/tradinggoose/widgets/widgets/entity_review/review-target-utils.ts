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

export interface EntitySelectionState {
  legacyEntityId: string | null
  reviewSessionId: string | null
  reviewEntityId: string | null
  reviewDraftSessionId: string | null
  reviewModel: string | null
  descriptor: ReviewTargetDescriptor | null
}

export function readReviewTargetDescriptor(
  source?: Record<string, unknown> | PairColorContext | null
): ReviewTargetDescriptor | null {
  if (!source || typeof source !== 'object') {
    return null
  }

  const record = source as Record<string, unknown>

  // Read from nested reviewTarget (PairColorContext) with flat-field fallback
  // (widget params still use flat fields).
  const nested = (record.reviewTarget ?? {}) as Record<string, unknown>

  const payload: Record<string, string | undefined> = {
    workspaceId: normalizeOptionalString(record.workspaceId) ?? undefined,
    yjsSessionId: normalizeOptionalString(record.yjsSessionId) ?? undefined,
  }
  for (const key of REVIEW_TARGET_FIELDS) {
    payload[key] =
      normalizeOptionalString(nested[key]) ??
      normalizeOptionalString(record[key]) ??
      undefined
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
  const source =
    options.pairContext && Object.keys(options.pairContext).length > 0
      ? options.pairContext
      : options.params

  const descriptor = readReviewTargetDescriptor(source)
  const rawLegacyValue =
    source && typeof source === 'object'
      ? normalizeOptionalString((source as Record<string, unknown>)[options.legacyIdKey])
      : null

  // Read review fields from nested reviewTarget (PairColorContext) or flat
  // fields (widget params / backward compat).
  const nested = source && typeof source === 'object'
    ? ((source as Record<string, unknown>).reviewTarget as PairReviewTarget | undefined)
    : undefined
  const flat = source as Record<string, unknown> | undefined

  return {
    legacyEntityId: rawLegacyValue ?? null,
    reviewSessionId:
      descriptor?.reviewSessionId ??
      normalizeOptionalString(nested?.reviewSessionId) ??
      normalizeOptionalString(flat?.reviewSessionId) ??
      null,
    reviewEntityId:
      descriptor?.entityId ??
      normalizeOptionalString(nested?.reviewEntityId) ??
      normalizeOptionalString(flat?.reviewEntityId) ??
      null,
    reviewDraftSessionId:
      descriptor?.draftSessionId ??
      normalizeOptionalString(nested?.reviewDraftSessionId) ??
      normalizeOptionalString(flat?.reviewDraftSessionId) ??
      null,
    reviewModel:
      descriptor?.reviewModel ??
      normalizeOptionalString(nested?.reviewModel) ??
      normalizeOptionalString(flat?.reviewModel) ??
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
  delete current.reviewModel
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
      reviewModel: serialized.reviewModel ?? null,
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
  reviewModel?: string | null
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
      reviewModel: options.reviewModel ?? 'gpt-5-fast',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve ${options.entityKind} review target`)
  }

  return payload as ResolvedReviewTarget
}
