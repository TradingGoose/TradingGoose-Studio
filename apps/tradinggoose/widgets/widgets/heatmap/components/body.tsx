'use client'

import { useCallback, useMemo } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { getListingIdentityKey, type ListingIdentity } from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { usePortfolioDetail } from '@/hooks/queries/trading-portfolio'
import type { LocaleCode } from '@/i18n/utils'
import { getPortfolioListingExposures } from '@/providers/trading/portfolio-selectors'
import type { WidgetComponentProps } from '@/widgets/types'
import { useWorkspaceWatchlistYjsDocuments } from '@/widgets/utils/watchlist-yjs'
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
} from '@/widgets/widgets/heatmap/contract'

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
  onWidgetParamsPatch,
  onWidgetLinkedParamsPatch,
}: WidgetComponentProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.heatmap.body
  const workspaceId = context?.workspaceId ?? null
  const canEditWidgetParams = Boolean(onWidgetParamsPatch)
  const widgetKey = widget?.key ?? 'heatmap'
  const widgetParams = params && typeof params === 'object' ? (params as HeatmapWidgetParams) : null
  const sourceMode = resolveHeatmapSourceMode(widgetParams)
  const watchlistSizeMetric = resolveHeatmapWatchlistSizeMetric(widgetParams)
  const marketProviderId = resolveHeatmapMarketProviderId(widgetParams)
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
  const patchWidgetParams = useCallback(
    (nextParams: Record<string, unknown>) => {
      if (!canEditWidgetParams) return
      onWidgetParamsPatch?.(nextParams)
    },
    [canEditWidgetParams, onWidgetParamsPatch]
  )
  const watchlistDocuments = useWorkspaceWatchlistYjsDocuments(
    sourceMode === 'watchlist' ? workspaceId : null
  )

  const watchlistDocumentsLoading =
    sourceMode === 'watchlist' && Boolean(workspaceId) && watchlistDocuments.isLoading
  const watchlistDocumentError =
    sourceMode === 'watchlist' && watchlistDocuments.error ? String(watchlistDocuments.error) : null
  const watchlistSources = useMemo(
    () =>
      sourceMode === 'watchlist' && (watchlistDocumentsLoading || watchlistDocumentError)
        ? []
        : resolveWatchlistHeatmapListings(watchlistDocuments.records),
    [sourceMode, watchlistDocumentError, watchlistDocuments.records, watchlistDocumentsLoading]
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
  const isTradingProviderReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    hasSelectedTradingProvider &&
    tradingProviderOptions.length > 0

  const { accountsQuery, activeServiceId, activePortfolioIdentity, services, portfolioIdentities } =
    usePortfolioIdentitySelection({
      providerId: tradingProviderId,
      serviceId: widgetParams?.serviceId,
      portfolioIdentity: widgetParams?.portfolioIdentity,
      enabled: sourceMode === 'portfolio' && isTradingProviderReady,
    })

  const snapshotQuery = usePortfolioDetail({
    workspaceId: workspaceId ?? undefined,
    provider: sourceMode === 'portfolio' && isTradingProviderReady ? tradingProviderId : undefined,
    serviceId: activeServiceId,
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
  const handleListingSelect = useCallback(
    (listing: ListingIdentity) => {
      onWidgetLinkedParamsPatch?.({ listing })
    },
    [onWidgetLinkedParamsPatch]
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
    return <HeatmapMessage message={copy.selectWorkspaceToUseHeatmap} />
  }

  if (sourceMode === 'watchlist') {
    if (watchlistDocumentsLoading) {
      return (
        <div className='flex h-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (watchlistDocumentError) {
      return <HeatmapMessage message={watchlistDocumentError} />
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
              : copy.failedToLoadTradingProviders
          }
        />
      )
    }

    if (!tradingProviderId || tradingProviderOptions.length === 0) {
      return <HeatmapMessage message={copy.selectTradingProviderToLoadPortfolioHoldings} />
    }

    if (!activePortfolioIdentity) {
      if (services.isLoading) {
        return (
          <div className='flex h-full items-center justify-center'>
            <LoadingAgent size='md' />
          </div>
        )
      }

      if (!activeServiceId) {
        return <HeatmapMessage message={copy.selectBrokerConnectionToLoadPortfolioHoldings} />
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
                : copy.failedToLoadBrokerAccounts
            }
          />
        )
      }

      if (portfolioIdentities.length === 0) {
        return <HeatmapMessage message={copy.noBrokerAccountsFoundForThisProviderConnection} />
      }

      return <HeatmapMessage message={copy.selectBrokerAccountToLoadPortfolioHoldings} />
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
              : copy.failedToLoadHoldings
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
            ? copy.noHoldingsListingsFoundForThisAccount
            : copy.noWatchlistListingsFound
        }
      />
    )
  }

  const quoteErrorMessage = quoteSnapshotsQuery.error
    ? quoteSnapshotsQuery.error instanceof Error
      ? quoteSnapshotsQuery.error.message
      : copy.failedToLoadMarketQuotes
    : null

  return (
    <div className='flex h-full flex-col gap-2 p-2'>
      <div className='min-h-0 flex-1'>
        <HeatmapTreemapChart
          cappedCount={cappedCount}
          errorMessage={quoteErrorMessage}
          isLoading={quoteSnapshotsQuery.isLoading && !quoteSnapshotsQuery.data}
          items={chartItems}
          onListingSelect={onWidgetLinkedParamsPatch ? handleListingSelect : undefined}
          totalCount={totalCount}
        />
      </div>
    </div>
  )
}
