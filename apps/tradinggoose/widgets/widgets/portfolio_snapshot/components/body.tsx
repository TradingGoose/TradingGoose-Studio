'use client'

import { useEffect, useMemo, useRef } from 'react'
import { LoadingAgent } from '@/components/ui/loading-agent'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import {
  useTradingAccounts,
  useTradingPortfolioPerformance,
  useTradingPortfolioSnapshot,
} from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { TradingPortfolioPerformanceWindow } from '@/providers/trading/types'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitPortfolioSnapshotParamsChange,
  usePortfolioSnapshotParamsPersistence,
} from '@/widgets/utils/portfolio-snapshot-params'
import { PortfolioSnapshotPerformanceChart } from '@/widgets/widgets/portfolio_snapshot/components/performance-chart'
import {
  getPortfolioSnapshotDefaultEnvironment,
  getPortfolioSnapshotDefaultWindow,
  getPortfolioSnapshotEnvironmentOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  getPortfolioSnapshotSupportedWindows,
  resolvePortfolioSnapshotCredentialProvider,
  resolvePortfolioSnapshotProviderId,
} from '@/widgets/widgets/portfolio_snapshot/components/shared'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

const PortfolioMessage = ({ message }: { message: string }) => (
  <div className='flex h-full items-center justify-center px-4 text-center text-muted-foreground text-sm'>
    {message}
  </div>
)

const CALENDAR_DAY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T(?:00:00:00\.000Z|12:00:00\.000Z)$/

const formatCurrency = (value: number | undefined, currency = 'USD') => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

const formatPercent = (value: number | null | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'N/A'
  }

  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
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

const StatCard = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className='rounded-sm border border-border/70 bg-card/40 p-3'>
    <div className='text-[11px] text-muted-foreground uppercase tracking-[0.14em]'>{label}</div>
    <div className='mt-1 font-medium text-base'>{value}</div>
    {hint ? <div className='mt-1 text-muted-foreground text-xs'>{hint}</div> : null}
  </div>
)

export function PortfolioSnapshotWidgetBody({
  panelId,
  widget,
  params,
  onWidgetParamsChange,
}: WidgetComponentProps) {
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
  const providerId = resolvePortfolioSnapshotProviderId(widgetParams, providerOptions)
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider =
    Boolean(widgetParams?.provider) && widgetParams?.provider === providerId
  const hasInvalidPersistedProvider =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    Boolean(widgetParams?.provider) &&
    !hasSelectedProvider
  const persistedCredentialId = hasValidPersistedProvider ? widgetParams?.credentialId : undefined
  const providerDefinition = hasSelectedProvider ? getTradingProviderDefinition(providerId) : null
  const environmentOptions = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const defaultEnvironment = hasSelectedProvider
    ? getPortfolioSnapshotDefaultEnvironment(providerId)
    : undefined
  const supportedWindows = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotSupportedWindows(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const defaultWindow = hasSelectedProvider
    ? getPortfolioSnapshotDefaultWindow(providerId)
    : undefined
  const credentialProviderId = hasSelectedProvider
    ? resolvePortfolioSnapshotCredentialProvider(providerId)
    : undefined
  const isProviderReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    hasSelectedProvider &&
    providerOptions.length > 0
  const refreshAt =
    typeof widgetParams?.runtime?.refreshAt === 'number' ? widgetParams.runtime.refreshAt : null
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
        environment: null,
        credentialId: null,
        accountId: null,
        selectedWindow: null,
      },
      panelId,
      widgetKey,
    })
  }, [hasInvalidPersistedProvider, panelId, widgetKey])

  const environment =
    hasSelectedProvider &&
    widgetParams?.environment &&
    environmentOptions.some((option) => option.id === widgetParams.environment)
      ? widgetParams.environment
      : defaultEnvironment

  useEffect(() => {
    if (providerAvailabilityQuery.isLoading) return
    if (providerAvailabilityQuery.error) return
    if (!hasSelectedProvider) return
    if (!hasValidPersistedProvider) return
    if (!environment) return
    if (widgetParams?.environment === environment) return
    emitPortfolioSnapshotParamsChange({
      params: { environment },
      panelId,
      widgetKey,
    })
  }, [
    environment,
    hasSelectedProvider,
    hasValidPersistedProvider,
    panelId,
    providerAvailabilityQuery.error,
    providerAvailabilityQuery.isLoading,
    widgetKey,
    widgetParams?.environment,
  ])

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

  const credentialsQuery = useOAuthCredentials(
    credentialProviderId,
    isProviderReady && Boolean(credentialProviderId)
  )
  const selectedCredential =
    persistedCredentialId && !credentialsQuery.isLoading && !credentialsQuery.error
      ? ((credentialsQuery.data ?? []).find(
          (credential) => credential.id === persistedCredentialId
        ) ?? null)
      : null
  const missingPersistedCredential =
    Boolean(persistedCredentialId) &&
    !credentialsQuery.isLoading &&
    !credentialsQuery.error &&
    !selectedCredential
  const activeCredentialId = missingPersistedCredential ? undefined : persistedCredentialId

  useEffect(() => {
    if (!missingPersistedCredential) return
    emitPortfolioSnapshotParamsChange({
      params: {
        credentialId: null,
        accountId: null,
      },
      panelId,
      widgetKey,
    })
  }, [missingPersistedCredential, panelId, widgetKey])

  const accountsQuery = useTradingAccounts({
    provider: isProviderReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: isProviderReady ? environment : undefined,
  })
  const accounts = activeCredentialId ? (accountsQuery.data ?? []) : []
  const singleAccount = accounts.length === 1 ? (accounts[0] ?? null) : null
  const resolvedAccount =
    accounts.find((account) => account.id === widgetParams?.accountId) ?? singleAccount ?? null

  useEffect(() => {
    if (!activeCredentialId) return
    if (accountsQuery.isLoading) return
    if (accountsQuery.error) return

    if (accounts.length === 0) {
      if (!widgetParams?.accountId) return
      emitPortfolioSnapshotParamsChange({
        params: { accountId: null },
        panelId,
        widgetKey,
      })
      return
    }

    if (accounts.length === 1) {
      const onlyAccount = accounts[0]
      if (!onlyAccount) return
      if (widgetParams?.accountId === onlyAccount.id) return
      emitPortfolioSnapshotParamsChange({
        params: { accountId: onlyAccount.id },
        panelId,
        widgetKey,
      })
      return
    }

    if (!widgetParams?.accountId) return
    if (resolvedAccount) return

    emitPortfolioSnapshotParamsChange({
      params: { accountId: null },
      panelId,
      widgetKey,
    })
  }, [
    accounts,
    activeCredentialId,
    accountsQuery.isLoading,
    panelId,
    resolvedAccount,
    widgetKey,
    widgetParams?.accountId,
  ])

  const snapshotQuery = useTradingPortfolioSnapshot({
    provider: isProviderReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: isProviderReady ? environment : undefined,
    accountId: resolvedAccount?.id,
  })

  const performanceQuery = useTradingPortfolioPerformance({
    provider: isProviderReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: isProviderReady ? environment : undefined,
    accountId: resolvedAccount?.id,
    selectedWindow: selectedWindow as TradingPortfolioPerformanceWindow | undefined,
  })

  useEffect(() => {
    if (refreshAt == null) return
    if (lastRefreshAtRef.current === refreshAt) return
    lastRefreshAtRef.current = refreshAt
    if (resolvedAccount?.id) {
      void snapshotQuery.refetch()
      void performanceQuery.refetch()
    }
  }, [performanceQuery, refreshAt, resolvedAccount?.id, snapshotQuery])

  if (providerAvailabilityQuery.isLoading) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
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
        <PortfolioMessage
          message={
            credentialsQuery.error instanceof Error
              ? credentialsQuery.error.message
              : 'Failed to load broker credentials.'
          }
        />
      )
    }

    const providerName = providerDefinition?.name ?? 'broker'
    const credentialArticle = /^[aeiou]/i.test(providerName) ? 'an' : 'a'
    return (
      <PortfolioMessage
        message={
          (credentialsQuery.data ?? []).length === 0
            ? `Connect ${providerName} in provider settings to get started.`
            : `Select ${credentialArticle} ${providerName} connection in provider settings to view an account snapshot.`
        }
      />
    )
  }

  if (accountsQuery.isLoading && accounts.length === 0) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
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

  if (accounts.length === 0) {
    return <PortfolioMessage message='No broker accounts found for the selected credential.' />
  }

  if (!resolvedAccount?.id) {
    return <PortfolioMessage message='Select a broker account to load this portfolio snapshot.' />
  }

  if (snapshotQuery.isLoading && !snapshotQuery.data) {
    return (
      <div className='flex h-full items-center justify-center'>
        <LoadingAgent size='md' />
      </div>
    )
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
  const currency = performance?.summary?.currency ?? snapshot.account.baseCurrency ?? 'USD'
  const activeWindows = performance?.supportedWindows ?? supportedWindows

  return (
    <div className='flex h-full min-h-0 flex-col gap-3 p-3'>
      <section className='flex min-h-0 flex-[1.15] flex-col rounded-sm border border-border/70 bg-card/30 p-3'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='font-medium text-sm'>Performance</div>
            <div className='mt-1 text-muted-foreground text-xs'>
              {snapshot.account.name ?? snapshot.account.id} · {environment}
            </div>
          </div>
          <div className='flex flex-wrap gap-1'>
            {activeWindows.map((window) => (
              <button
                key={window}
                type='button'
                className={`rounded-sm border px-2 py-1 text-xs ${
                  selectedWindow === window
                    ? 'border-foreground/40 bg-foreground/10 text-foreground'
                    : 'border-border/70 text-muted-foreground'
                }`}
                onClick={() => {
                  emitPortfolioSnapshotParamsChange({
                    params: { selectedWindow: window },
                    panelId,
                    widgetKey,
                  })
                }}
              >
                {window}
              </button>
            ))}
          </div>
        </div>

        <div className='mt-3 flex min-h-0 flex-1 flex-col gap-3'>
          {performanceQuery.isLoading && !performance ? (
            <div className='flex flex-1 items-center justify-center'>
              <LoadingAgent size='sm' />
            </div>
          ) : performanceQuery.error ? (
            <PortfolioMessage
              message={
                performanceQuery.error instanceof Error
                  ? performanceQuery.error.message
                  : 'Failed to load performance history.'
              }
            />
          ) : performance?.summary ? (
            <>
              <div className='grid grid-cols-2 gap-3 md:grid-cols-5'>
                <StatCard
                  label='Return'
                  value={formatCurrency(performance.summary.absoluteReturn, currency)}
                  hint={formatPercent(performance.summary.percentReturn)}
                />
                <StatCard
                  label='Start'
                  value={formatCurrency(performance.summary.startEquity, currency)}
                />
                <StatCard
                  label='Current'
                  value={formatCurrency(performance.summary.endEquity, currency)}
                />
                <StatCard
                  label='High'
                  value={formatCurrency(performance.summary.highEquity, currency)}
                />
                <StatCard
                  label='Low'
                  value={formatCurrency(performance.summary.lowEquity, currency)}
                  hint={`As of ${formatAsOf(performance.summary.asOf)}`}
                />
              </div>
              <div className='min-h-[180px] flex-1'>
                <PortfolioSnapshotPerformanceChart series={performance.series} />
              </div>
            </>
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

      <section className='rounded-sm border border-border/70 bg-card/30 p-3'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <div className='font-medium text-sm'>Current Summary</div>
            <div className='mt-1 text-muted-foreground text-xs'>
              {snapshot.provider?.name ?? providerDefinition?.name ?? providerId} · {environment} ·{' '}
              {snapshot.account.status ?? 'unknown'} · {snapshot.account.type}
            </div>
          </div>
          <div className='text-right text-muted-foreground text-xs'>
            <div>{snapshot.account.name ?? snapshot.account.id}</div>
            <div>As of {formatAsOf(snapshot.asOf)}</div>
          </div>
        </div>

        <div className='mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6'>
          <StatCard
            label='Portfolio Value'
            value={formatCurrency(snapshot.accountSummary.totalPortfolioValue, currency)}
          />
          <StatCard
            label='Cash'
            value={formatCurrency(snapshot.accountSummary.totalCashValue, currency)}
          />
          <StatCard
            label='Holdings'
            value={formatCurrency(snapshot.accountSummary.totalHoldingsValue, currency)}
          />
          <StatCard
            label='Buying Power'
            value={formatCurrency(snapshot.accountSummary.buyingPower, currency)}
          />
          <StatCard
            label='Unrealized P&L'
            value={formatCurrency(snapshot.accountSummary.totalUnrealizedPnl, currency)}
          />
          <StatCard
            label='Positions'
            value={String(snapshot.positions.length)}
            hint={snapshot.account.id}
          />
        </div>
      </section>
    </div>
  )
}
