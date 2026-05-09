'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { getListingIdentityKey, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { usePortfolioDetail } from '@/hooks/queries/trading-portfolio'
import { getPortfolioListingExposures } from '@/providers/trading/portfolio-selectors'
import { useWatchlists } from '@/hooks/queries/watchlists'
import { useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitHeatmapParamsChange,
  useHeatmapParamsPersistence,
} from '@/widgets/utils/heatmap-params'
import { usePortfolioIdentitySelection } from '@/widgets/widgets/components/use-portfolio-identity-selection'
import { HeatmapTreemapChart } from '@/widgets/widgets/heatmap/components/heatmap-treemap-chart'
import {
  getHeatmapTradingProviderAvailabilityIds,
  getHeatmapTradingProviderOptions,
  resolveHeatmapMarketProviderId,
  resolveHeatmapSourceMode,
  resolveHeatmapTradingProviderId,
  resolveHeatmapWatchlistSizeMetric,
} from '@/widgets/widgets/heatmap/components/shared'
import {
  capHeatmapListings,
  type HeatmapSourceListing,
  resolvePortfolioHeatmapListings,
  resolveWatchlistHeatmapListings,
} from '@/widgets/widgets/heatmap/components/source-items'
import type {
  HeatmapWatchlistSizeMetric,
  HeatmapWidgetParams,
} from '@/widgets/widgets/heatmap/types'

const HeatmapMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
    {message}
  </div>
)

const isPositiveFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

const resolvePortfolioSizeValue = (grossQuantity: number | undefined, lastPrice?: number | null) =>
  isPositiveFiniteNumber(grossQuantity) && isPositiveFiniteNumber(lastPrice)
    ? grossQuantity * lastPrice
    : undefined

const resolveWatchlistSizeValue = (
  quote: MarketQuoteSnapshot | null,
  metric: HeatmapWatchlistSizeMetric
) => {
  const value = metric === 'volume' ? quote?.volume : quote?.volumeUsd
  return isPositiveFiniteNumber(value) ? value : undefined
}

export function HeatmapWidgetBody({
  context,
  panelId,
  widget,
  params,
  pairColor = 'gray',
  onWidgetParamsChange,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const widgetKey = widget?.key ?? 'heatmap'
  const widgetParams = params && typeof params === 'object' ? (params as HeatmapWidgetParams) : null
  const sourceMode = resolveHeatmapSourceMode(widgetParams)
  const watchlistSizeMetric = resolveHeatmapWatchlistSizeMetric(widgetParams)
  const marketProviderId = resolveHeatmapMarketProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null

  useHeatmapParamsPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params: params && typeof params === 'object' ? (params as Record<string, unknown>) : null,
  })

  useEffect(() => {
    const nextParams: Record<string, unknown> = {}
    if (!widgetParams?.sourceMode) nextParams.sourceMode = sourceMode
    if (Object.keys(nextParams).length === 0) return
    emitHeatmapParamsChange({ params: nextParams, panelId, widgetKey })
  }, [panelId, sourceMode, widgetKey, widgetParams])

  const watchlistsQuery = useWatchlists(
    sourceMode === 'watchlist' ? (workspaceId ?? undefined) : undefined
  )
  const watchlistSources = useMemo(
    () =>
      watchlistsQuery.isPlaceholderData
        ? []
        : resolveWatchlistHeatmapListings(watchlistsQuery.data ?? []),
    [watchlistsQuery.data, watchlistsQuery.isPlaceholderData]
  )

  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getHeatmapTradingProviderAvailabilityIds(),
    sourceMode === 'portfolio'
  )
  const tradingProviderOptions = useMemo(
    () => getHeatmapTradingProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const tradingProviderId = resolveHeatmapTradingProviderId(widgetParams, tradingProviderOptions)
  const hasSelectedTradingProvider = Boolean(tradingProviderId)
  const hasInvalidPersistedTradingProvider =
    sourceMode === 'portfolio' &&
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    Boolean(widgetParams?.tradingProvider) &&
    !hasSelectedTradingProvider
  const isTradingProviderReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    hasSelectedTradingProvider &&
    tradingProviderOptions.length > 0

  useEffect(() => {
    if (!hasInvalidPersistedTradingProvider) return
    emitHeatmapParamsChange({
      params: {
        tradingProvider: null,
        credentialServiceId: null,
        portfolioIdentity: null,
      },
      panelId,
      widgetKey,
    })
  }, [hasInvalidPersistedTradingProvider, panelId, widgetKey])

  const {
    accountsQuery,
    activeCredentialServiceId,
    activePortfolioIdentity,
    credentialServices,
    portfolioIdentities,
  } = usePortfolioIdentitySelection({
    workspaceId,
    providerId: tradingProviderId,
    credentialServiceId: widgetParams?.credentialServiceId,
    portfolioIdentity: widgetParams?.portfolioIdentity,
    enabled: sourceMode === 'portfolio' && isTradingProviderReady,
    panelId,
    widgetKey,
    emitParamsChange: emitHeatmapParamsChange,
  })

  const snapshotQuery = usePortfolioDetail({
    workspaceId: workspaceId ?? undefined,
    provider: sourceMode === 'portfolio' && isTradingProviderReady ? tradingProviderId : undefined,
    credentialServiceId: activeCredentialServiceId,
    portfolioIdentity: activePortfolioIdentity,
    enabled: sourceMode === 'portfolio',
  })
  const listingExposures = useMemo(
    () => getPortfolioListingExposures(snapshotQuery.data),
    [snapshotQuery.data]
  )
  const portfolioSources = useMemo<HeatmapSourceListing[]>(
    () => resolvePortfolioHeatmapListings(listingExposures.map((position) => position.listing)),
    [listingExposures]
  )
  const portfolioQuantityByKey = useMemo(() => {
    const quantityByKey = new Map<string, number>()

    for (const position of listingExposures) {
      quantityByKey.set(getListingIdentityKey(position.listing), position.grossQuantity)
    }

    return quantityByKey
  }, [listingExposures])
  const sourceListings = sourceMode === 'portfolio' ? portfolioSources : watchlistSources
  const {
    visibleItems: cappedSourceListings,
    cappedCount,
    totalCount,
  } = useMemo(() => capHeatmapListings(sourceListings), [sourceListings])
  const listings = useMemo(
    () => sourceListings.map((sourceListing) => sourceListing.listing),
    [sourceListings]
  )
  const cappedListings = useMemo(
    () => cappedSourceListings.map((sourceListing) => sourceListing.listing),
    [cappedSourceListings]
  )
  const quoteItems = useMemo(
    () =>
      cappedSourceListings.map((sourceListing) => ({
        key: sourceListing.key,
        listing: sourceListing.listing,
      })),
    [cappedSourceListings]
  )
  const quoteSnapshotsQuery = useMarketQuoteSnapshots({
    workspaceId: workspaceId ?? undefined,
    provider: marketProviderId || undefined,
    items: quoteItems,
    auth: widgetParams?.marketAuth,
    providerParams: widgetParams?.marketProviderParams,
    refreshKey: refreshAt,
    enabled: Boolean(marketProviderId && cappedListings.length > 0),
  })
  const resolvedListingsQuery = useResolvedListings({
    listings: cappedListings,
    enabled: cappedListings.length > 0,
  })
  const setPairContext = useSetPairColorContext()
  const handleListingSelect = useCallback(
    (listing: ListingIdentity) => {
      if (pairColor === 'gray') return
      setPairContext(pairColor, { listing })
    },
    [pairColor, setPairContext]
  )
  const chartItems = useMemo(
    () =>
      cappedSourceListings.map((sourceListing) => {
        const key = sourceListing.key
        const quote = quoteSnapshotsQuery.data?.[key] ?? null
        const sizeValue =
          sourceMode === 'portfolio'
            ? resolvePortfolioSizeValue(portfolioQuantityByKey.get(key), quote?.lastPrice)
            : resolveWatchlistSizeValue(quote, watchlistSizeMetric)

        return {
          ...sourceListing,
          key,
          resolvedListing: resolvedListingsQuery.data?.[key] ?? null,
          quote,
          sizeValue,
        }
      }),
    [
      cappedSourceListings,
      portfolioQuantityByKey,
      quoteSnapshotsQuery.data,
      resolvedListingsQuery.data,
      sourceMode,
      watchlistSizeMetric,
    ]
  )

  if (!workspaceId) {
    return <HeatmapMessage message='Select a workspace to use the heatmap.' />
  }

  if (sourceMode === 'watchlist') {
    if (watchlistsQuery.isLoading || watchlistsQuery.isPlaceholderData) {
      return (
        <div className='flex h-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (watchlistsQuery.error) {
      return (
        <HeatmapMessage
          message={
            watchlistsQuery.error instanceof Error
              ? watchlistsQuery.error.message
              : 'Failed to load watchlists.'
          }
        />
      )
    }
  }

  if (sourceMode === 'portfolio') {
    if (providerAvailabilityQuery.isLoading) {
      return (
        <div className='flex h-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (providerAvailabilityQuery.error) {
      return (
        <HeatmapMessage
          message={
            providerAvailabilityQuery.error instanceof Error
              ? providerAvailabilityQuery.error.message
              : 'Failed to load trading providers.'
          }
        />
      )
    }

    if (!tradingProviderId || tradingProviderOptions.length === 0) {
      return <HeatmapMessage message='Select a trading provider to load portfolio holdings.' />
    }

    if (!activePortfolioIdentity) {
      if (credentialServices.isLoading) {
        return (
          <div className='flex h-full items-center justify-center'>
            <LoadingAgent size='md' />
          </div>
        )
      }

      if (!activeCredentialServiceId) {
        return <HeatmapMessage message='Select a broker connection to load portfolio holdings.' />
      }

      if (accountsQuery.isLoading && portfolioIdentities.length === 0) {
        return (
          <div className='flex h-full items-center justify-center'>
            <LoadingAgent size='md' />
          </div>
        )
      }

      if (accountsQuery.error) {
        return (
          <HeatmapMessage
            message={
              accountsQuery.error instanceof Error
                ? accountsQuery.error.message
                : 'Failed to load broker accounts.'
            }
          />
        )
      }

      if (portfolioIdentities.length === 0) {
        return <HeatmapMessage message='No broker accounts found for this provider connection.' />
      }

      return <HeatmapMessage message='Select a broker account to load portfolio holdings.' />
    }

    if (snapshotQuery.isLoading && portfolioSources.length === 0) {
      return (
        <div className='flex h-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (snapshotQuery.error) {
      return (
        <HeatmapMessage
          message={
            snapshotQuery.error instanceof Error
              ? snapshotQuery.error.message
              : 'Failed to load holdings.'
          }
        />
      )
    }
  }

  if (listings.length === 0) {
    return (
      <HeatmapMessage
        message={
          sourceMode === 'portfolio'
            ? 'No holdings listings found for this account.'
            : 'No watchlist listings found.'
        }
      />
    )
  }

  const quoteErrorMessage = quoteSnapshotsQuery.error
    ? quoteSnapshotsQuery.error instanceof Error
      ? quoteSnapshotsQuery.error.message
      : 'Failed to load market quotes.'
    : null

  return (
    <div className='flex h-full flex-col gap-2 p-2'>
      <div className='min-h-0 flex-1'>
        <HeatmapTreemapChart
          cappedCount={cappedCount}
          errorMessage={quoteErrorMessage}
          isLoading={quoteSnapshotsQuery.isLoading && !quoteSnapshotsQuery.data}
          items={chartItems}
          onListingSelect={pairColor === 'gray' ? undefined : handleListingSelect}
          totalCount={totalCount}
        />
      </div>
    </div>
  )
}
