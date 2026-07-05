'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import {
  WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
  type WatchlistWidgetUpdateEventDetail,
} from '@/widgets/events'
import type { WidgetInstance } from '@/widgets/layout'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  resolveEntityId,
  resolveEntityIdFromList,
  usePersistResolvedEntityId,
} from '@/widgets/utils/entity-selection'
import { mergeWatchlistParams, sanitizeWatchlistParams } from '@/widgets/utils/watchlist-params'
import { useWatchlistSelectionPersistence } from '@/widgets/utils/watchlist-selection'
import { useWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

const resolveProviderId = (params: WatchlistWidgetParams | null) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

interface UseWatchlistParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const areValuesEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => areValuesEqual(value, right[index]))
  }

  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    return leftKeys.every((key) => key in right && areValuesEqual(left[key], right[key]))
  }

  return false
}

function useWatchlistParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseWatchlistParamsPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(sanitizeWatchlistParams(params))

  useEffect(() => {
    latestParamsRef.current = sanitizeWatchlistParams(params)
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) return

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WatchlistWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams = latestParamsRef.current
      const nextParams = mergeWatchlistParams(currentParams, detail.params)

      if (areValuesEqual(currentParams, nextParams)) return

      latestParamsRef.current = nextParams
      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(
      WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
      handleParamsUpdate as EventListener
    )

    return () => {
      window.removeEventListener(
        WATCHLIST_WIDGET_UPDATE_PARAMS_EVENT,
        handleParamsUpdate as EventListener
      )
    }
  }, [onWidgetParamsChange, panelId, widget?.key])
}

export function useWatchlistWidgetState({
  context,
  panelId,
  pairColor = 'gray',
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const widgetKey = widget?.key ?? 'watchlist'
  const resolvedPairColor = ((widget?.pairColor ?? pairColor ?? 'gray') as PairColor) ?? 'gray'
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const widgetParams =
    params && typeof params === 'object' ? (params as WatchlistWidgetParams) : null
  const providerId = resolveProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()
  const { members: watchlistMembers, isLoading, error } = useEntityList('watchlist', workspaceId)
  const paramsRecord =
    params && typeof params === 'object' ? (params as Record<string, unknown>) : null

  useWatchlistParamsPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params: paramsRecord,
  })

  useWatchlistSelectionPersistence({
    onWidgetParamsChange,
    panelId,
    pairColor: resolvedPairColor,
    params: paramsRecord,
    scopeKey: widgetKey,
    onWatchlistSelect: (watchlistId) => {
      setPairContext(resolvedPairColor, { watchlistId })
    },
  })

  useEffect(() => {
    if (!providerId) return
    if (widgetParams?.provider) return
    onWidgetParamsChange?.(mergeWatchlistParams(paramsRecord, { provider: providerId }))
  }, [providerId, widgetParams?.provider, onWidgetParamsChange, paramsRecord])

  const storedWatchlistId = resolveEntityId('watchlistId', {
    params: isLinkedToColorPair ? null : paramsRecord,
    pairContext: isLinkedToColorPair ? pairContext : null,
  })
  const watchlistIds = useMemo(
    () => watchlistMembers.map((entry) => entry.entityId),
    [watchlistMembers]
  )
  const resolvedWatchlistId = useMemo(
    () =>
      resolveEntityIdFromList({
        requestedEntityId: storedWatchlistId,
        entityIds: watchlistIds,
        useDefaultEntity: !isLinkedToColorPair,
      }),
    [isLinkedToColorPair, storedWatchlistId, watchlistIds]
  )
  const selectedWatchlistMember = useMemo(
    () => watchlistMembers.find((entry) => entry.entityId === resolvedWatchlistId) ?? null,
    [resolvedWatchlistId, watchlistMembers]
  )
  const selectedDocument = useWatchlistYjsDocument({
    workspaceId,
    watchlistId: selectedWatchlistMember?.entityId,
    member: selectedWatchlistMember,
  })

  usePersistResolvedEntityId({
    entityId: resolvedWatchlistId,
    entityIdKey: 'watchlistId',
    onWidgetParamsChange,
    pairColor: resolvedPairColor,
    params: paramsRecord,
  })

  return {
    workspaceId,
    resolvedPairColor,
    isLinkedToColorPair,
    widgetParams,
    providerId,
    refreshAt,
    pairContext,
    setPairContext,
    watchlistMembers,
    isLoading,
    error,
    selectedDocument,
    selectedWatchlist: selectedDocument.record,
  }
}
