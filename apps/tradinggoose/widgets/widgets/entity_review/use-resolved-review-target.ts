'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ResolvedReviewTarget, ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { resolveEntityReviewTarget } from '@/widgets/widgets/entity_review/review-target-utils'

interface UseResolvedReviewTargetOptions {
  workspaceId: string | null
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string | null
}

function doesResolvedTargetMatchRequest(options: {
  resolvedTarget: ResolvedReviewTarget | null
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string
}): boolean {
  const descriptor = options.resolvedTarget?.descriptor
  if (!descriptor) {
    return false
  }

  if (
    descriptor.workspaceId !== options.workspaceId ||
    descriptor.entityKind !== options.entityKind
  ) {
    return false
  }

  return descriptor.entityId === options.entityId
}

export function useResolvedReviewTarget({
  workspaceId,
  entityKind,
  entityId,
}: UseResolvedReviewTargetOptions) {
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedReviewTarget | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    if (!workspaceId) {
      setResolvedTarget(null)
      setError(null)
      setIsResolving(false)
      return
    }

    if (!entityId) {
      setResolvedTarget(null)
      setError(null)
      setIsResolving(false)
      return
    }

    if (
      doesResolvedTargetMatchRequest({
        resolvedTarget,
        workspaceId,
        entityKind,
        entityId,
      })
    ) {
      setError(null)
      setIsResolving(false)
      return
    }

    setIsResolving(true)
    setError(null)

    resolveEntityReviewTarget({
      workspaceId,
      entityKind,
      entityId,
    })
      .then((resolved) => {
        if (cancelled) {
          return
        }

        setResolvedTarget(resolved)
      })
      .catch((resolveError) => {
        if (cancelled) {
          return
        }

        setResolvedTarget(null)
        setError(resolveError instanceof Error ? resolveError.message : 'Failed to resolve target')
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolving(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [entityId, entityKind, resolvedTarget, workspaceId])

  const descriptor = useMemo(() => resolvedTarget?.descriptor ?? null, [resolvedTarget?.descriptor])

  return {
    descriptor,
    runtime: resolvedTarget?.runtime ?? null,
    isResolving,
    error,
  }
}
