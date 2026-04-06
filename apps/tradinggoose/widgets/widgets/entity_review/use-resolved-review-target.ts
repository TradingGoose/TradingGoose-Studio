'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type {
  ResolvedReviewTarget,
  ReviewEntityKind,
  ReviewTargetDescriptor,
} from '@/lib/copilot/review-sessions/types'
import { resolveEntityReviewTarget } from '@/widgets/widgets/entity_review/review-target-utils'

interface UseResolvedReviewTargetOptions {
  workspaceId: string | null
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  params?: Record<string, unknown> | null
  pairColor: PairColor
  pairContext?: PairColorContext | null
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  setPairContext?: (color: PairColor, context: PairColorContext) => void
  legacyIdKey: keyof PairColorContext & string
  selectionState: {
    legacyEntityId: string | null
    reviewSessionId: string | null
    reviewEntityId: string | null
    reviewDraftSessionId: string | null
    descriptor: ReviewTargetDescriptor | null
  }
  buildWidgetParams: (options: {
    currentParams?: Record<string, unknown> | null
    legacyIdKey: string
    descriptor: ReviewTargetDescriptor | null
    legacyEntityId?: string | null
  }) => Record<string, unknown> | null
  buildPairContext: (options: {
    existing?: PairColorContext | null
    legacyIdKey: keyof PairColorContext
    descriptor: ReviewTargetDescriptor | null
    legacyEntityId?: string | null
  }) => PairColorContext
}

function doesResolvedTargetMatchRequest(options: {
  resolvedTarget: ResolvedReviewTarget | null
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId?: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
}): boolean {
  const descriptor = options.resolvedTarget?.descriptor
  if (!descriptor) {
    return false
  }

  if (descriptor.workspaceId !== options.workspaceId || descriptor.entityKind !== options.entityKind) {
    return false
  }

  if (options.reviewSessionId != null && descriptor.reviewSessionId !== options.reviewSessionId) {
    return false
  }

  if (options.entityId != null && descriptor.entityId !== options.entityId) {
    return false
  }

  if (options.draftSessionId != null && descriptor.draftSessionId !== options.draftSessionId) {
    return false
  }

  return true
}

function buildResolveRequestKey(options: {
  workspaceId: string
  entityKind: Exclude<ReviewEntityKind, 'workflow'>
  entityId?: string | null
  draftSessionId?: string | null
  reviewSessionId?: string | null
}): string {
  return JSON.stringify({
    workspaceId: options.workspaceId,
    entityKind: options.entityKind,
    entityId: options.entityId ?? null,
    draftSessionId: options.draftSessionId ?? null,
    reviewSessionId: options.reviewSessionId ?? null,
  })
}

export function useResolvedReviewTarget({
  workspaceId,
  entityKind,
  params,
  pairColor,
  pairContext,
  onWidgetParamsChange,
  setPairContext,
  legacyIdKey,
  selectionState,
  buildWidgetParams,
  buildPairContext,
}: UseResolvedReviewTargetOptions) {
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedReviewTarget | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastSatisfiedRequestKeyRef = useRef<string | null>(null)

  const isLinkedToColorPair = pairColor !== 'gray'
  const requestedEntityId = selectionState.reviewEntityId ?? selectionState.legacyEntityId
  const requestedDraftSessionId = selectionState.reviewDraftSessionId
  const requestedReviewSessionId = selectionState.reviewSessionId

  const persistDescriptor = useCallback(
    (descriptor: ReviewTargetDescriptor | null, legacyEntityId?: string | null) => {
      if (isLinkedToColorPair) {
        if (!setPairContext) {
          return
        }

        setPairContext(
          pairColor,
          buildPairContext({
            existing: pairContext,
            legacyIdKey,
            descriptor,
            legacyEntityId: legacyEntityId ?? descriptor?.entityId ?? null,
          })
        )
        return
      }

      onWidgetParamsChange?.(
        buildWidgetParams({
          currentParams: params,
          legacyIdKey,
          descriptor,
          legacyEntityId: legacyEntityId ?? descriptor?.entityId ?? null,
        })
      )
    },
    [
      buildPairContext,
      buildWidgetParams,
      isLinkedToColorPair,
      legacyIdKey,
      onWidgetParamsChange,
      pairColor,
      pairContext,
      params,
      setPairContext,
    ]
  )
  const persistDescriptorRef = useRef(persistDescriptor)

  useEffect(() => {
    persistDescriptorRef.current = persistDescriptor
  }, [persistDescriptor])

  const clearSelection = useCallback(() => {
    setResolvedTarget(null)
    setError(null)
    persistDescriptor(null, null)
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

    if (!requestedEntityId && !requestedDraftSessionId && !requestedReviewSessionId) {
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
      draftSessionId: requestedDraftSessionId,
      reviewSessionId: requestedReviewSessionId,
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
        draftSessionId: requestedDraftSessionId,
        reviewSessionId: requestedReviewSessionId,
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
      draftSessionId: requestedDraftSessionId,
      reviewSessionId: requestedReviewSessionId,
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
  }, [
    entityKind,
    resolvedTarget,
    requestedDraftSessionId,
    requestedEntityId,
    requestedReviewSessionId,
    workspaceId,
  ])

  const descriptor = useMemo(
    () => resolvedTarget?.descriptor ?? selectionState.descriptor,
    [resolvedTarget?.descriptor, selectionState.descriptor]
  )

  return {
    descriptor,
    runtime: resolvedTarget?.runtime ?? null,
    isResolving,
    error,
    clearSelection,
    persistDescriptor,
  }
}
