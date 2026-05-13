'use client'

import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import { resolveEntityId } from '@/widgets/widgets/entity_review/resolve-entity-id'

export interface EntitySelectionState {
  selectedEntityId: string | null
}

export function readEntitySelectionState(options: {
  params?: Record<string, unknown> | null
  pairContext?: PairColorContext | null
  entityIdKey: keyof PairColorContext | string
}): EntitySelectionState {
  const selectedEntityId = resolveEntityId(options.entityIdKey, {
    params: options.params,
    pairContext: options.pairContext as Record<string, unknown> | null | undefined,
  })

  return {
    selectedEntityId: selectedEntityId ?? null,
  }
}

export async function resolveEntityReviewTarget(options: {
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string
}): Promise<ResolvedReviewTarget> {
  const response = await fetch('/api/copilot/review-sessions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: options.workspaceId,
      entityKind: options.entityKind,
      entityId: options.entityId,
      accessMode: 'read',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve ${options.entityKind} review target`)
  }

  return payload as ResolvedReviewTarget
}
