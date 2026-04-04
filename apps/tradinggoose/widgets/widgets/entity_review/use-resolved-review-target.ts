'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
    reviewModel: string | null
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
  selectedModel: string
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
  selectedModel,
}: UseResolvedReviewTargetOptions) {
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedReviewTarget | null>(null)
  const [isResolving, setIsResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isLinkedToColorPair = pairColor !== 'gray'
  const requestedEntityId = selectionState.reviewEntityId ?? selectionState.legacyEntityId
  const requestedDraftSessionId = selectionState.reviewDraftSessionId
  const requestedReviewSessionId = selectionState.reviewSessionId
  const requestedReviewModel = selectionState.reviewModel ?? selectedModel

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
      return
    }

    if (!requestedEntityId && !requestedDraftSessionId && !requestedReviewSessionId) {
      setResolvedTarget(null)
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
      reviewModel: requestedReviewModel,
    })
      .then((resolved) => {
        if (cancelled) {
          return
        }

        setResolvedTarget(resolved)
        persistDescriptor(resolved.descriptor, resolved.descriptor.entityId ?? requestedEntityId)
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
    persistDescriptor,
    requestedDraftSessionId,
    requestedEntityId,
    requestedReviewModel,
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
