'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { resolveEntityReviewTarget } from '@/widgets/widgets/entity_review/review-target-utils'

interface UseResolvedReviewTargetOptions {
  workspaceId: string | null
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  pairColor: PairColor
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  setPairContext?: (color: PairColor, context: PairColorContext) => void
  entityIdKey: keyof PairColorContext & string
  selectionState: {
    selectedEntityId: string | null
  }
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

function buildResolveRequestKey(options: {
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId: string
}): string {
  return JSON.stringify({
    workspaceId: options.workspaceId,
    entityKind: options.entityKind,
    entityId: options.entityId,
  })
}

function buildSelectedEntityParams(entityIdKey: string, selectedEntityId: string | null) {
  return selectedEntityId ? { [entityIdKey]: selectedEntityId } : null
}

export function useResolvedReviewTarget({
  workspaceId,
  entityKind,
  pairColor,
  onWidgetParamsChange,
  setPairContext,
  entityIdKey,
  selectionState,
}: UseResolvedReviewTargetOptions) {
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedReviewTarget | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastSatisfiedRequestKeyRef = useRef<string | null>(null)

  const isLinkedToColorPair = pairColor !== 'gray'
  const requestedEntityId = selectionState.selectedEntityId

  const persistDescriptor = useCallback(
    (descriptor: ReviewTargetDescriptor | null, selectedEntityId?: string | null) => {
      setResolvedTarget(descriptor ? { descriptor, runtime: null } : null)
      setError(null)
      lastSatisfiedRequestKeyRef.current = null
      const nextEntityId = selectedEntityId ?? descriptor?.entityId ?? null

      if (isLinkedToColorPair) {
        if (!setPairContext) {
          return
        }

        setPairContext(pairColor, {
          [entityIdKey]: nextEntityId,
        } as PairColorContext)
        return
      }

      onWidgetParamsChange?.(buildSelectedEntityParams(entityIdKey, nextEntityId))
    },
    [
      isLinkedToColorPair,
      entityIdKey,
      onWidgetParamsChange,
      pairColor,
      setPairContext,
    ]
  )
  const persistDescriptorRef = useRef(persistDescriptor)

  useEffect(() => {
    persistDescriptorRef.current = persistDescriptor
  }, [persistDescriptor])

  useEffect(() => {
    let cancelled = false

    if (!workspaceId) {
      setResolvedTarget(null)
      setError(null)
      setIsResolving(false)
      lastSatisfiedRequestKeyRef.current = null
      return
    }

    if (!requestedEntityId) {
      setResolvedTarget(null)
      setError(null)
      setIsResolving(false)
      lastSatisfiedRequestKeyRef.current = null
      return
    }

    const requestKey = buildResolveRequestKey({
      workspaceId,
      entityKind,
      entityId: requestedEntityId,
    })

    if (lastSatisfiedRequestKeyRef.current === requestKey) {
      setError(null)
      setIsResolving(false)
      return
    }

    if (
      doesResolvedTargetMatchRequest({
        resolvedTarget,
        workspaceId,
        entityKind,
        entityId: requestedEntityId,
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
      entityId: requestedEntityId,
    })
      .then((resolved) => {
        if (cancelled) {
          return
        }

        lastSatisfiedRequestKeyRef.current = requestKey
        setResolvedTarget(resolved)
        persistDescriptorRef.current(
          resolved.descriptor,
          resolved.descriptor.entityId ?? requestedEntityId
        )
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
  }, [entityKind, resolvedTarget, requestedEntityId, workspaceId])

  const descriptor = useMemo(() => resolvedTarget?.descriptor ?? null, [resolvedTarget?.descriptor])

  return {
    descriptor,
    runtime: resolvedTarget?.runtime ?? null,
    isResolving,
    error,
    persistDescriptor,
  }
}
