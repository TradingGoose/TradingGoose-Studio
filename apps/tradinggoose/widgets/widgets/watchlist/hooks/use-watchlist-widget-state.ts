'use client'

import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useSelectedWatchlistYjsDocument } from '@/widgets/utils/watchlist-yjs'
import { resolveEntityId } from '@/widgets/widget-contracts'
import {
  providerOptions,
  resolveSeriesMarketProviderId,
} from '@/widgets/widgets/data_chart/options'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/contract'

const resolveProviderId = (params: WatchlistWidgetParams | null) => {
  return resolveSeriesMarketProviderId(params?.provider, providerOptions)
}

export function useWatchlistWidgetState({
  context,
  pairColor = 'gray',
  widget,
  params,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = ((widget?.pairColor ?? pairColor ?? 'gray') as PairColor) ?? 'gray'
  const isLinkedToColorPair = resolvedPairColor !== 'gray'
  const widgetParams =
    params && typeof params === 'object' ? (params as WatchlistWidgetParams) : null
  const providerId = resolveProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
  const paramsRecord =
    params && typeof params === 'object' ? (params as Record<string, unknown>) : null

  const requestedWatchlistId = resolveEntityId('watchlistId', {
    params: paramsRecord,
  })
  const selectedDocument = useSelectedWatchlistYjsDocument({
    workspaceId,
    watchlistId: requestedWatchlistId,
  })

  return {
    workspaceId,
    resolvedPairColor,
    isLinkedToColorPair,
    widgetParams,
    providerId,
    refreshAt,
    isLoading: selectedDocument.isLoading,
    error: selectedDocument.error,
    selectedDocument,
    selectedWatchlist: selectedDocument.record,
  }
}
