'use client'

import { type ReactNode, useEffect, useMemo, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { Separator } from '@/components/ui/separator'
import { getListingIdentityKey } from '@/lib/listing/identity'
import { MARKET_QUOTE_SNAPSHOT_REQUEST_CAP } from '@/lib/market/quote-snapshot-contract'
import { cn } from '@/lib/utils'
import { useMarketQuoteSnapshots } from '@/hooks/queries/market-quote-snapshots'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import {
  usePortfolioDetail,
  usePortfolioPerformance,
} from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import { getPortfolioListingExposures } from '@/providers/trading/portfolio-selectors'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitPortfolioSnapshotParamsChange,
  usePortfolioSnapshotParamsPersistence,
} from '@/widgets/utils/portfolio-snapshot-params'
import { usePortfolioIdentitySelection } from '@/widgets/widgets/components/use-portfolio-identity-selection'
import { PortfolioSnapshotPerformanceChart } from '@/widgets/widgets/portfolio_snapshot/components/performance-chart'
import {
  getPortfolioSnapshotDefaultWindow,
  getPortfolioSnapshotMarketProviderOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  getPortfolioSnapshotSupportedWindows,
  resolvePortfolioSnapshotMarketProviderId,
  resolvePortfolioSnapshotProviderId,
} from '@/widgets/widgets/portfolio_snapshot/components/shared'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

const PortfolioMessage = ({ message }: { message: string }) => (
  <Empty className='h-full min-h-[180px] rounded-none border-0 bg-transparent p-4'>
    <EmptyHeader>
      <EmptyDescription>{message}</EmptyDescription>
    </EmptyHeader>
  </Empty>
)

const PortfolioLoading = ({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md'
  className?: string
}) => (
  <div className={cn('flex h-full min-h-[180px] items-center justify-center', className)}>
    <LoadingAgent size={size} />
  </div>
)

const CALENDAR_DAY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:00:00:00\.000Z|12:00:00\.000Z)$/
const PORTFOLIO_SNAPSHOT_QUOTE_CAP = MARKET_QUOTE_SNAPSHOT_REQUEST_CAP

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const formatCurrency = (value: number | null | undefined, currency = 'USD') => {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

const formatPercent = (value: number | null | undefined) => {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

const formatSignedCurrency = (value: number | null | undefined, currency = 'USD') => {
  if (!isFiniteNumber(value)) {
    return 'N/A'
  }

  const formatted = formatCurrency(Math.abs(value), currency)
  return `${value >= 0 ? '+' : '-'}${formatted}`
}

const formatAsOf = (timestamp: string | undefined) => {
  if (!timestamp) return 'N/A'
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return 'N/A'
  if (CALENDAR_DAY_TIMESTAMP_PATTERN.test(timestamp)) {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(new Date(parsed))
  }
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(parsed))
}

type MetricTone = 'neutral' | 'positive' | 'negative' | 'warning'

const metricToneClassName: Record<MetricTone, string> = {
  neutral: 'text-foreground',
  positive: 'text-emerald-600 dark:text-emerald-400',
  negative: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-300',
}

const getNumberTone = (value: number | null | undefined): MetricTone => {
  if (!isFiniteNumber(value) || value === 0) return 'neutral'
  return value > 0 ? 'positive' : 'negative'
}

const MetricGroup = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div
    className={cn(
      'grid gap-px overflow-hidden rounded-md border border-border/60 bg-border/60 [grid-template-columns:repeat(auto-fit,minmax(min(100%,7.5rem),1fr))]',
      className
    )}
  >
    {children}
  </div>
)

const MetricTile = ({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string
  value: string
  hint?: string
  tone?: MetricTone
}) => (
  <div className='min-w-0 bg-background/80 px-3 py-2.5'>
    <div className='text-[10px] text-muted-foreground uppercase leading-4 tracking-[0.08em] [overflow-wrap:anywhere]'>
      {label}
    </div>
    <div
      className={cn(
        'mt-0.5 font-medium font-mono text-sm tabular-nums leading-5 [overflow-wrap:anywhere]',
        metricToneClassName[tone]
      )}
    >
      {value}
    </div>
    {hint ? (
      <div className='mt-0.5 text-[11px] text-muted-foreground leading-4 [overflow-wrap:anywhere]'>
        {hint}
      </div>
    ) : null}
  </div>
)

export function PortfolioSnapshotWidgetBody({
  context,
  panelId,
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) {
  const workspaceId = context?.workspaceId ?? null
  const widgetKey = widget?.key ?? 'portfolio_snapshot'
  const widgetParams =
    params && typeof params === 'object' ? (params as PortfolioSnapshotWidgetParams) : null
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getPortfolioSnapshotProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getPortfolioSnapshotProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const marketProviderOptions = useMemo(() => getPortfolioSnapshotMarketProviderOptions(), [])
  const providerId = resolvePortfolioSnapshotProviderId(widgetParams, providerOptions)
  const marketProviderId = resolvePortfolioSnapshotMarketProviderId(
    widgetParams,
    marketProviderOptions
  )
  const marketProviderName =
    marketProviderOptions.find((option) => option.id === marketProviderId)?.name ?? marketProviderId
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider =
    Boolean(widgetParams?.provider) && widgetParams?.provider === providerId
  const hasInvalidPersistedProvider =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    Boolean(widgetParams?.provider) &&
    !hasSelectedProvider
  const providerDefinition = hasSelectedProvider ? getTradingProviderDefinition(providerId) : null
  const supportedWindows = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotSupportedWindows(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const defaultWindow = hasSelectedProvider
    ? getPortfolioSnapshotDefaultWindow(providerId)
    : undefined
  const isProviderReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    hasSelectedProvider &&
    providerOptions.length > 0
  const refreshAt = isFiniteNumber(widgetParams?.runtime?.refreshAt)
    ? widgetParams.runtime.refreshAt
    : null
  const lastRefreshAtRef = useRef<number | null>(null)

  usePortfolioSnapshotParamsPersistence({
    onWidgetParamsChange,
    panelId,
    widget,
    params: params && typeof params === 'object' ? (params as Record<string, unknown>) : null,
  })

  useEffect(() => {
    if (!hasInvalidPersistedProvider) return
    emitPortfolioSnapshotParamsChange({
      params: {
        provider: null,
        serviceId: null,
        portfolioIdentity: null,
        selectedWindow: null,
      },
      panelId,
      widgetKey,
    })
  }, [hasInvalidPersistedProvider, panelId, widgetKey])

  const selectedWindow =
    widgetParams?.selectedWindow && supportedWindows.includes(widgetParams.selectedWindow)
      ? widgetParams.selectedWindow
      : defaultWindow

  useEffect(() => {
    if (providerAvailabilityQuery.isLoading) return
    if (providerAvailabilityQuery.error) return
    if (!hasSelectedProvider) return
    if (!hasValidPersistedProvider) return
    if (!selectedWindow) return
    if (widgetParams?.selectedWindow === selectedWindow) return
    emitPortfolioSnapshotParamsChange({
      params: { selectedWindow },
      panelId,
      widgetKey,
    })
  }, [
    hasSelectedProvider,
    hasValidPersistedProvider,
    panelId,
    providerAvailabilityQuery.error,
    providerAvailabilityQuery.isLoading,
    selectedWindow,
    widgetKey,
    widgetParams?.selectedWindow,
  ])

  const {
    accountsQuery,
    activeServiceId,
    activePortfolioIdentity,
    services,
    portfolioIdentities,
  } = usePortfolioIdentitySelection({
    workspaceId,
    providerId,
    serviceId: widgetParams?.serviceId,
    portfolioIdentity: widgetParams?.portfolioIdentity,
    enabled: isProviderReady,
    panelId,
    widgetKey,
    emitParamsChange: emitPortfolioSnapshotParamsChange,
  })

  const snapshotQuery = usePortfolioDetail({
    workspaceId: workspaceId ?? undefined,
    provider: isProviderReady ? providerId : undefined,
    serviceId: activeServiceId,
    portfolioIdentity: activePortfolioIdentity,
  })

  const listingExposures = useMemo(
    () => getPortfolioListingExposures(snapshotQuery.data),
    [snapshotQuery.data]
  )
  const quotePositions = useMemo(
    () =>
      listingExposures.map((position) => ({
        ...position,
        key: getListingIdentityKey(position.listing),
      })),
    [listingExposures]
  )
  const cappedQuotePositions = useMemo(
    () => quotePositions.slice(0, PORTFOLIO_SNAPSHOT_QUOTE_CAP),
    [quotePositions]
  )

  const quoteItems = useMemo(
    () =>
      cappedQuotePositions.map((position) => ({
        key: position.key,
        listing: position.listing,
      })),
    [cappedQuotePositions]
  )
  const quoteSnapshotsQuery = useMarketQuoteSnapshots({
    workspaceId: workspaceId ?? undefined,
    provider: marketProviderId || undefined,
    items: quoteItems,
    auth: widgetParams?.marketAuth,
    providerParams: widgetParams?.marketProviderParams,
    refreshKey: refreshAt,
    enabled: Boolean(marketProviderId && activePortfolioIdentity && quoteItems.length > 0),
  })

  const performanceQuery = usePortfolioPerformance({
    workspaceId: workspaceId ?? undefined,
    provider: isProviderReady ? providerId : undefined,
    serviceId: activeServiceId,
    portfolioIdentity: activePortfolioIdentity,
    selectedWindow: selectedWindow as TradingPortfolioPerformanceWindow | undefined,
  })

  useEffect(() => {
    if (refreshAt == null) return
    if (lastRefreshAtRef.current === refreshAt) return
    lastRefreshAtRef.current = refreshAt
    if (activePortfolioIdentity) {
      void snapshotQuery.refetch()
      void performanceQuery.refetch()
    }
  }, [activePortfolioIdentity, performanceQuery, refreshAt, snapshotQuery])

  if (providerAvailabilityQuery.isLoading) {
    return <PortfolioLoading />
  }

  if (providerAvailabilityQuery.error) {
    return (
      <PortfolioMessage
        message={
          providerAvailabilityQuery.error instanceof Error
            ? providerAvailabilityQuery.error.message
            : 'Failed to load trading providers.'
        }
      />
    )
  }

  if (!providerId || providerOptions.length === 0) {
    if (providerOptions.length === 0) {
      return <PortfolioMessage message='No trading providers are configured.' />
    }

    return <PortfolioMessage message='Select a trading provider to get started.' />
  }

  if (!activePortfolioIdentity) {
    if (services.isLoading) {
      return <PortfolioLoading />
    }

    if (!activeServiceId) {
      return (
        <PortfolioMessage message='Select a broker connection to load this portfolio snapshot.' />
      )
    }

    if (accountsQuery.isLoading && portfolioIdentities.length === 0) {
      return <PortfolioLoading />
    }

    if (accountsQuery.error) {
      return (
        <PortfolioMessage
          message={
            accountsQuery.error instanceof Error
              ? accountsQuery.error.message
              : 'Failed to load broker accounts.'
          }
        />
      )
    }

    if (portfolioIdentities.length === 0) {
      return <PortfolioMessage message='No broker accounts found for this provider connection.' />
    }

    return <PortfolioMessage message='Select a broker account to load this portfolio snapshot.' />
  }

  if (snapshotQuery.isLoading && !snapshotQuery.data) {
    return <PortfolioLoading />
  }

  if (snapshotQuery.error || !snapshotQuery.data) {
    return (
      <PortfolioMessage
        message={
          snapshotQuery.error instanceof Error
            ? snapshotQuery.error.message
            : 'Failed to load portfolio snapshot.'
        }
      />
    )
  }

  const snapshot = snapshotQuery.data
  const performance = performanceQuery.data
  const currency = performance?.summary?.currency ?? snapshot.baseCurrency ?? 'USD'
  const activeWindows = supportedWindows
  const quoteErrorMessage =
    quoteSnapshotsQuery.error instanceof Error
      ? quoteSnapshotsQuery.error.message
      : quoteSnapshotsQuery.error
        ? 'Failed to load market quotes.'
        : null
  const quoteSummary = cappedQuotePositions.reduce(
    (summary, position) => {
      const quote = quoteSnapshotsQuery.data?.[position.key]
      const lastPrice = quote?.lastPrice
      const previousClose = quote?.previousClose
      const change = quote?.change
      if (!isFiniteNumber(lastPrice) || !isFiniteNumber(previousClose)) {
        return summary
      }

      const perUnitDayChange = isFiniteNumber(change) ? change : lastPrice - previousClose
      summary.quoteValue += lastPrice * position.grossQuantity
      summary.previousValue += previousClose * position.grossQuantity
      summary.dayChange += perUnitDayChange * position.signedQuantity
      summary.quotedPositions += 1
      return summary
    },
    { dayChange: 0, previousValue: 0, quoteValue: 0, quotedPositions: 0 }
  )
  const quoteDayChange = quoteSummary.quotedPositions > 0 ? quoteSummary.dayChange : null
  const quotePreviousValue = quoteSummary.quotedPositions > 0 ? quoteSummary.previousValue : null
  const quoteDayPercent =
    isFiniteNumber(quoteDayChange) && isFiniteNumber(quotePreviousValue) && quotePreviousValue !== 0
      ? (quoteDayChange / quotePreviousValue) * 100
      : null
  const quotedPositionsHint =
    quotePositions.length > cappedQuotePositions.length
      ? `Quote metrics use first ${PORTFOLIO_SNAPSHOT_QUOTE_CAP} of ${quotePositions.length} holdings`
      : undefined
  const quoteStatusText =
    quoteErrorMessage ??
    (quoteSnapshotsQuery.isLoading && !quoteSnapshotsQuery.data
      ? 'Loading quotes'
      : quoteSnapshotsQuery.isFetching
        ? 'Refreshing quotes'
        : (quotedPositionsHint ??
          (marketProviderId
            ? quoteItems.length > 0
          ? `${quoteSummary.quotedPositions}/${cappedQuotePositions.length} quoted`
              : 'No holdings with market listings'
            : 'No market provider')))
  const accountMetaText = [
    snapshot.providerName ?? providerDefinition?.name ?? providerId,
    snapshot.accountStatus ?? 'unknown',
    snapshot.accountType ?? 'unknown',
  ].join(' · ')
  const performanceTone = getNumberTone(performance?.summary?.absoluteReturn)
  const quoteDayTone = getNumberTone(quoteDayChange)
  const quoteStatusTone: MetricTone = quoteErrorMessage
    ? 'negative'
    : quoteSnapshotsQuery.isFetching
      ? 'warning'
      : 'neutral'

  return (
    <div className='flex h-full min-h-0 flex-col bg-background'>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <div className='space-y-3'>
          <section className='overflow-hidden bg-card/30'>
            <div className='flex flex-wrap items-center justify-between gap-3 border-border/60 border-b px-3 py-2.5'>
              <div className='min-w-0'>
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <h3 className='font-medium text-sm'>Performance</h3>
                  {selectedWindow ? (
                    <Badge
                      variant='outline'
                      className='rounded-sm px-1.5 py-0 font-medium font-mono text-[10px]'
                    >
                      {selectedWindow}
                    </Badge>
                  ) : null}
                </div>
                <div className='mt-1 truncate text-muted-foreground text-xs'>
                  {snapshot.accountName ?? snapshot.accountId}
                </div>
              </div>

              <div
                role='tablist'
                aria-label='Performance window'
                className='flex flex-wrap items-center gap-1'
              >
                {activeWindows.map((window) => (
                  <Button
                    key={window}
                    type='button'
                    role='tab'
                    aria-selected={selectedWindow === window}
                    variant={selectedWindow === window ? 'secondary' : 'ghost'}
                    size='sm'
                    className={cn(
                      'h-7 cursor-pointer rounded-sm px-2 font-mono text-xs',
                      selectedWindow === window
                        ? 'border border-border/60 bg-muted text-foreground'
                        : 'text-muted-foreground'
                    )}
                    onClick={() => {
                      emitPortfolioSnapshotParamsChange({
                        params: { selectedWindow: window },
                        panelId,
                        widgetKey,
                      })
                    }}
                  >
                    {window}
                  </Button>
                ))}
              </div>
            </div>

            <div className='p-3'>
              {performanceQuery.isLoading && !performance ? (
                <PortfolioLoading size='sm' className='min-h-[310px]' />
              ) : performanceQuery.error ? (
                <PortfolioMessage
                  message={
                    performanceQuery.error instanceof Error
                      ? performanceQuery.error.message
                      : 'Failed to load performance history.'
                  }
                />
              ) : performance?.summary ? (
                <div className='space-y-3'>
                  <MetricGroup>
                    <MetricTile
                      label='Return'
                      value={formatSignedCurrency(performance.summary.absoluteReturn, currency)}
                      hint={formatPercent(performance.summary.percentReturn)}
                      tone={performanceTone}
                    />
                    <MetricTile
                      label='Start'
                      value={formatCurrency(performance.summary.startEquity, currency)}
                    />
                    <MetricTile
                      label='Current'
                      value={formatCurrency(performance.summary.endEquity, currency)}
                    />
                    <MetricTile
                      label='High'
                      value={formatCurrency(performance.summary.highEquity, currency)}
                      tone='positive'
                    />
                    <MetricTile
                      label='Low'
                      value={formatCurrency(performance.summary.lowEquity, currency)}
                      hint={`As of ${formatAsOf(performance.summary.asOf)}`}
                    />
                  </MetricGroup>
                  <div className='h-[230px] min-h-[210px] rounded-md border border-border/60 bg-background/70 p-2'>
                    <PortfolioSnapshotPerformanceChart
                      series={performance.series}
                      currency={currency}
                    />
                  </div>
                </div>
              ) : (
                <PortfolioMessage
                  message={
                    performance?.unavailableReason ??
                    'Performance history is unavailable for the selected account.'
                  }
                />
              )}
            </div>
          </section>

          <section className='overflow-hidden border-border/70 border-t bg-card/30'>
            <div className='flex flex-wrap items-start justify-between gap-3 border-border/60 border-b px-3 py-2.5'>
              <div className='min-w-0'>
                <div className='flex min-w-0 flex-wrap items-center gap-2'>
                  <h3 className='font-medium text-sm'>Current Summary</h3>
                  <Badge
                    variant='outline'
                    className='rounded-sm px-1.5 py-0 font-medium text-[10px]'
                  >
                    {snapshot.accountStatus ?? 'unknown'}
                  </Badge>
                </div>
                <div className='mt-1 truncate text-muted-foreground text-xs'>{accountMetaText}</div>
              </div>
              <div className='text-right text-muted-foreground text-xs'>
                <div className='font-medium text-foreground'>
                  {snapshot.accountName ?? snapshot.accountId}
                </div>
                <div>As of {formatAsOf(snapshot.asOf)}</div>
              </div>
            </div>

            <div className='p-3'>
              <MetricGroup>
                <MetricTile
                  label='Portfolio Value'
                  value={formatCurrency(snapshot.summary.totalPortfolioValue, currency)}
                />
                <MetricTile
                  label='Cash'
                  value={formatCurrency(snapshot.summary.totalCashValue, currency)}
                />
                <MetricTile
                  label='Holdings'
                  value={formatCurrency(snapshot.summary.totalHoldingsValue, currency)}
                />
                <MetricTile
                  label='Buying Power'
                  value={formatCurrency(snapshot.summary.buyingPower, currency)}
                />
                <MetricTile
                  label='Unrealized P&L'
                  value={formatSignedCurrency(snapshot.summary.totalUnrealizedPnl, currency)}
                  tone={getNumberTone(snapshot.summary.totalUnrealizedPnl)}
                />
                <MetricTile
                  label='Positions'
                  value={String(snapshot.positions.length)}
                  hint={snapshot.accountId}
                />
              </MetricGroup>
            </div>
            <Separator className='my-3 bg-border/60' />

            <div className='p-3'>
              <div className='flex flex-wrap items-end justify-between gap-2'>
                <div className='min-w-0'>
                  <div className='flex min-w-0 flex-wrap items-center gap-2'>
                    <h3 className='font-medium text-sm'>Market Quotes</h3>
                    <Badge
                      variant='outline'
                      className='rounded-sm px-1.5 py-0 font-medium text-[10px]'
                    >
                      {marketProviderName || 'No market provider'}
                    </Badge>
                  </div>
                  <div className='mt-1 truncate text-muted-foreground text-xs'>
                    Quote-backed intraday estimate
                  </div>
                </div>
                <div className={cn('text-right text-xs', metricToneClassName[quoteStatusTone])}>
                  {quoteStatusText}
                </div>
              </div>

              <MetricGroup className='mt-2'>
                <MetricTile
                  label='Quote Value'
                  value={
                    quoteErrorMessage
                      ? 'N/A'
                      : quoteSummary.quotedPositions > 0
                        ? formatCurrency(quoteSummary.quoteValue, currency)
                        : 'N/A'
                  }
                  hint={quoteErrorMessage ?? marketProviderId ?? 'No market provider'}
                  tone={quoteErrorMessage ? 'negative' : 'neutral'}
                />
                <MetricTile
                  label='Day Change'
                  value={quoteErrorMessage ? 'N/A' : formatSignedCurrency(quoteDayChange, currency)}
                  hint={quoteSnapshotsQuery.isFetching ? 'Refreshing' : undefined}
                  tone={quoteErrorMessage ? 'negative' : quoteDayTone}
                />
                <MetricTile
                  label='Day %'
                  value={quoteErrorMessage ? 'N/A' : formatPercent(quoteDayPercent)}
                  tone={quoteErrorMessage ? 'negative' : getNumberTone(quoteDayPercent)}
                />
                <MetricTile
                  label='Quoted Positions'
                  value={
                    quoteErrorMessage
                      ? `0/${cappedQuotePositions.length}`
                      : `${quoteSummary.quotedPositions}/${cappedQuotePositions.length}`
                  }
                  hint={quotedPositionsHint}
                />
              </MetricGroup>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
