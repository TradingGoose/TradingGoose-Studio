'use client'

import { useEffect, useMemo } from 'react'
import { useEntityList } from '@/lib/yjs/use-entity-fields'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  resolveEntityId,
  resolveEntityIdFromList,
  usePersistResolvedEntityId,
} from '@/widgets/utils/entity-selection'
import {
  emitWatchlistParamsChange,
  useWatchlistParamsPersistence,
} from '@/widgets/utils/watchlist-params'
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
    emitWatchlistParamsChange({
      params: { provider: providerId },
      panelId,
      widgetKey,
    })
  }, [providerId, widgetParams?.provider, panelId, widgetKey])

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
