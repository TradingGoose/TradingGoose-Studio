'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ResolvedReviewTarget, ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { resolveCopilotEntityReviewTarget } from '@/widgets/widgets/copilot/review-target-utils'

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

    if (!workspaceId || !entityId) {
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
  }, [entityId, entityKind, resolvedTarget, workspaceId])

  const descriptor = useMemo(() => resolvedTarget?.descriptor ?? null, [resolvedTarget?.descriptor])

  return {
    descriptor,
    runtime: resolvedTarget?.runtime ?? null,
    isResolving,
    error,
  }
}
