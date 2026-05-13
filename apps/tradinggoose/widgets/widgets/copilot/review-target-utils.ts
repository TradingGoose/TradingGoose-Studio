'use client'

import type {
  ResolvedReviewTarget,
  ReviewAccessMode,
  ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'

export async function resolveCopilotEntityReviewTarget(options: {
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string
  accessMode?: ReviewAccessMode
}): Promise<ResolvedReviewTarget> {
  const response = await fetch('/api/copilot/review-sessions/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspaceId: options.workspaceId,
      entityKind: options.entityKind,
      entityId: options.entityId,
      accessMode: options.accessMode ?? 'read',
    }),
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve ${options.entityKind} review target`)
  }

  return payload as ResolvedReviewTarget
}
