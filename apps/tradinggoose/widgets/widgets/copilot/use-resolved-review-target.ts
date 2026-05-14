'use client'

import { useEffect, useState } from 'react'
import type { ResolvedReviewTarget, ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { resolveCopilotEntityReviewTarget } from '@/widgets/widgets/copilot/review-target-utils'

interface UseResolvedReviewTargetOptions {
  workspaceId: string | null
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
}

export function useResolvedReviewTarget({
  workspaceId,
  entityKind,
  entityId,
}: UseResolvedReviewTargetOptions) {
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedReviewTarget | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const descriptor = resolvedTarget?.descriptor
  const currentTarget =
    workspaceId &&
    entityId &&
    descriptor?.workspaceId === workspaceId &&
    descriptor.entityKind === entityKind &&
    descriptor.entityId === entityId
      ? resolvedTarget
      : null

  useEffect(() => {
    let cancelled = false

    if (!workspaceId || !entityId) {
      setResolvedTarget(null)
      setError(null)
      setIsResolving(false)
      return
    }

    if (currentTarget) {
      setError(null)
      setIsResolving(false)
      return
    }

    setIsResolving(true)
    setError(null)

    resolveCopilotEntityReviewTarget({
      workspaceId,
      entityKind,
      entityId,
      accessMode: 'read',
    })
      .then((resolved) => {
        if (!cancelled) {
          setResolvedTarget(resolved)
        }
      })
      .catch((resolveError) => {
        if (!cancelled) {
          setResolvedTarget(null)
          setError(
            resolveError instanceof Error ? resolveError.message : 'Failed to resolve target'
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolving(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentTarget, entityId, entityKind, workspaceId])

  return {
    descriptor: currentTarget?.descriptor ?? null,
    runtime: currentTarget?.runtime ?? null,
    isResolving,
    error,
  }
}
