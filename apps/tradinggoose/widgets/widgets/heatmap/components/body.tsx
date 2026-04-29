'use client'

import { useEffect, useMemo } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { getListingIdentityKey } from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { useResolvedListings } from '@/hooks/queries/listing-resolution'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { useTradingAccounts, useTradingHoldingsListings } from '@/hooks/queries/trading-portfolio'
import { useWatchlists } from '@/hooks/queries/watchlists'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitHeatmapParamsChange,
  useHeatmapParamsPersistence,
} from '@/widgets/utils/heatmap-params'
import { HeatmapTreemapChart } from '@/widgets/widgets/heatmap/components/heatmap-treemap-chart'
import {
  getHeatmapTradingProviderAvailabilityIds,
  getHeatmapTradingProviderOptions,
  resolveHeatmapCredentialProvider,
  resolveHeatmapEnvironment,
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
  const hasValidPersistedTradingProvider =
    Boolean(widgetParams?.tradingProvider) && widgetParams?.tradingProvider === tradingProviderId
  const hasInvalidPersistedTradingProvider =
    sourceMode === 'portfolio' &&
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    Boolean(widgetParams?.tradingProvider) &&
    !hasSelectedTradingProvider
  const providerDefinition = hasSelectedTradingProvider
    ? getTradingProviderDefinition(tradingProviderId)
    : null
  const tradingEnvironment = hasSelectedTradingProvider
    ? resolveHeatmapEnvironment(tradingProviderId, widgetParams?.environment)
    : undefined
  const isTradingProviderReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    hasSelectedTradingProvider &&
    tradingProviderOptions.length > 0
  const credentialProviderId = hasSelectedTradingProvider
    ? resolveHeatmapCredentialProvider(tradingProviderId)
    : undefined
  const credentialsQuery = useOAuthCredentials(
    credentialProviderId,
    sourceMode === 'portfolio' && isTradingProviderReady && Boolean(credentialProviderId)
  )
  const activeCredentialId = widgetParams?.credentialId

  useEffect(() => {
    if (!hasInvalidPersistedTradingProvider) return
    emitHeatmapParamsChange({
      params: {
        tradingProvider: null,
        environment: null,
        credentialId: null,
        accountId: null,
      },
      panelId,
      widgetKey,
    })
  }, [hasInvalidPersistedTradingProvider, panelId, widgetKey])

  useEffect(() => {
    if (sourceMode !== 'portfolio') return
    if (providerAvailabilityQuery.isLoading) return
    if (providerAvailabilityQuery.error) return
    if (!hasSelectedTradingProvider) return
    if (!hasValidPersistedTradingProvider) return
    if (!tradingEnvironment) return
    if (widgetParams?.environment === tradingEnvironment) return
    emitHeatmapParamsChange({
      params: { environment: tradingEnvironment },
      panelId,
      widgetKey,
    })
  }, [
    hasSelectedTradingProvider,
    hasValidPersistedTradingProvider,
    panelId,
    providerAvailabilityQuery.error,
    providerAvailabilityQuery.isLoading,
    sourceMode,
    tradingEnvironment,
    widgetKey,
    widgetParams?.environment,
  ])

  const accountsQuery = useTradingAccounts({
    provider: sourceMode === 'portfolio' && isTradingProviderReady ? tradingProviderId : undefined,
    credentialId: sourceMode === 'portfolio' ? activeCredentialId : undefined,
    environment:
      sourceMode === 'portfolio' && isTradingProviderReady ? tradingEnvironment : undefined,
  })
  const accounts = activeCredentialId ? (accountsQuery.data ?? []) : []
  const singleAccount = accounts.length === 1 ? (accounts[0] ?? null) : null
  const activeAccountId = widgetParams?.accountId ?? singleAccount?.id

  useEffect(() => {
    if (sourceMode !== 'portfolio') return
    if (!activeCredentialId) return
    if (accountsQuery.isLoading) return
    if (accountsQuery.error) return

    if (accounts.length === 1) {
      const onlyAccount = accounts[0]
      if (!onlyAccount) return
      if (widgetParams?.accountId) return
      emitHeatmapParamsChange({
        params: { accountId: onlyAccount.id },
        panelId,
        widgetKey,
      })
    }
  }, [
    accounts,
    accountsQuery.error,
    accountsQuery.isLoading,
    activeCredentialId,
    panelId,
    sourceMode,
    widgetKey,
    widgetParams?.accountId,
  ])

  const holdingsListingsQuery = useTradingHoldingsListings({
    provider: sourceMode === 'portfolio' && isTradingProviderReady ? tradingProviderId : undefined,
    credentialId: activeCredentialId,
    environment:
      sourceMode === 'portfolio' && isTradingProviderReady ? tradingEnvironment : undefined,
    accountId: activeAccountId,
  })
  const portfolioSources = useMemo<HeatmapSourceListing[]>(
    () =>
      resolvePortfolioHeatmapListings(
        (holdingsListingsQuery.data?.positionListings ?? []).map((position) => position.listing)
      ),
    [holdingsListingsQuery.data?.positionListings]
  )
  const portfolioQuantityByKey = useMemo(() => {
    const quantityByKey = new Map<string, number>()

    for (const position of holdingsListingsQuery.data?.positionListings ?? []) {
      quantityByKey.set(getListingIdentityKey(position.listing), position.grossQuantity)
    }

    return quantityByKey
  }, [holdingsListingsQuery.data?.positionListings])
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
    enabled: cappedListings.length > 0,
  })
  const resolvedListingsQuery = useResolvedListings({
    listings: cappedListings,
    enabled: cappedListings.length > 0,
  })
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

    if (!activeCredentialId) {
      if (credentialsQuery.isLoading) {
        return (
          <div className='flex h-full items-center justify-center'>
            <LoadingAgent size='md' />
          </div>
        )
      }

      if (credentialsQuery.error) {
        return (
          <HeatmapMessage
            message={
              credentialsQuery.error instanceof Error
                ? credentialsQuery.error.message
                : 'Failed to load broker credentials.'
            }
          />
        )
      }

      const providerName = providerDefinition?.name ?? 'broker'
      return (
        <HeatmapMessage message={`Select a ${providerName} connection in provider settings.`} />
      )
    }

    if (!activeAccountId) {
      if (accountsQuery.isLoading && accounts.length === 0) {
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

      return <HeatmapMessage message='Select a broker account to load portfolio holdings.' />
    }

    if (holdingsListingsQuery.isLoading && portfolioSources.length === 0) {
      return (
        <div className='flex h-full items-center justify-center'>
          <LoadingAgent size='md' />
        </div>
      )
    }

    if (holdingsListingsQuery.error) {
      return (
        <HeatmapMessage
          message={
            holdingsListingsQuery.error instanceof Error
              ? holdingsListingsQuery.error.message
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
          totalCount={totalCount}
        />
      </div>
    </div>
  )
}
