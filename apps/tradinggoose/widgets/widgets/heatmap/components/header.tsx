'use client'

import { useEffect, useMemo } from 'react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitHeatmapParamsChange } from '@/widgets/utils/heatmap-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import {
  getHeatmapMarketProviderOptions,
  getHeatmapTradingEnvironmentOptions,
  getHeatmapTradingProviderAvailabilityIds,
  getHeatmapTradingProviderOptions,
  HEATMAP_SOURCE_MODES,
  resolveHeatmapCredentialProvider,
  resolveHeatmapMarketProviderId,
  resolveHeatmapSourceMode,
  resolveHeatmapTradingProviderId,
  shouldPersistHeatmapMarketProviderDefault,
} from '@/widgets/widgets/heatmap/components/shared'
import type { HeatmapWidgetParams } from '@/widgets/widgets/heatmap/types'

type HeaderControlProps = {
  panelId?: string
  widgetKey: string
  params: HeatmapWidgetParams | null
}

function HeatmapMarketControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const marketProviderOptions = useMemo(() => getHeatmapMarketProviderOptions(), [])
  const marketProviderId = resolveHeatmapMarketProviderId(params, marketProviderOptions)

  useEffect(() => {
    if (!shouldPersistHeatmapMarketProviderDefault(params, marketProviderId)) return
    emitHeatmapParamsChange({
      params: { marketProvider: marketProviderId },
      panelId,
      widgetKey,
    })
  }, [marketProviderId, panelId, params, widgetKey])

  return (
    <MarketProviderControls
      value={marketProviderId}
      options={marketProviderOptions}
      providerParams={params?.marketProviderParams}
      authParams={params?.marketAuth}
      onChange={(nextProvider) => {
        if (!nextProvider || nextProvider === marketProviderId) return
        emitHeatmapParamsChange({
          params: {
            marketProvider: nextProvider,
            marketProviderParams: null,
            marketAuth: null,
            runtime: { refreshAt: Date.now() },
          },
          panelId,
          widgetKey,
        })
      }}
      onSettingsSave={({ providerParams, auth }) => {
        emitHeatmapParamsChange({
          params: {
            marketProviderParams: providerParams,
            marketAuth: auth,
            runtime: { refreshAt: Date.now() },
          },
          panelId,
          widgetKey,
        })
      }}
    />
  )
}

function HeatmapSourceControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const sourceMode = resolveHeatmapSourceMode(params)

  return (
    <Tabs
      value={sourceMode}
      onValueChange={(nextMode) => {
        if (nextMode === sourceMode) return
        emitHeatmapParamsChange({
          params: { sourceMode: nextMode },
          panelId,
          widgetKey,
        })
      }}
    >
      <TabsList className={widgetHeaderButtonGroupClassName('h-8 rounded-sm p-0')}>
        {HEATMAP_SOURCE_MODES.map((mode) => (
          <TabsTrigger key={mode.id} value={mode.id} className='h-8 px-2 text-xs'>
            {mode.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

function HeatmapPortfolioControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getHeatmapTradingProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getHeatmapTradingProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveHeatmapTradingProviderId(params, providerOptions)
  const hasSelectedProvider = Boolean(providerId)
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolveHeatmapCredentialProvider(providerId)
      : undefined
  const environmentOptions = useMemo(
    () => (hasSelectedProvider ? getHeatmapTradingEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )

  return (
    <TradingProviderControls
      providerId={providerId}
      providerOptions={providerOptions}
      credentialProviderId={credentialProviderId}
      environmentOptions={environmentOptions}
      credentialId={params?.credentialId}
      environment={params?.environment}
      accountId={params?.accountId}
      toolName='Heatmap'
      onProviderChange={(nextProvider) => {
        if (!nextProvider || nextProvider === providerId) return
        emitHeatmapParamsChange({
          params: {
            tradingProvider: nextProvider,
            credentialId: null,
            environment: null,
            accountId: null,
          },
          panelId,
          widgetKey,
        })
      }}
      onAccountSelect={({ credentialId, environment, accountId }) => {
        emitHeatmapParamsChange({
          params: { credentialId, environment, accountId },
          panelId,
          widgetKey,
        })
      }}
    />
  )
}

function HeatmapRefreshControl({ panelId, widgetKey }: HeaderControlProps) {
  return (
    <WidgetHeaderRefreshButton
      label='Refresh heatmap'
      onClick={() => {
        emitHeatmapParamsChange({
          params: { runtime: { refreshAt: Date.now() } },
          panelId,
          widgetKey,
        })
      }}
    />
  )
}

export const renderHeatmapHeader: DashboardWidgetDefinition['renderHeader'] = ({
  panelId,
  widget,
}) => {
  const widgetKey = widget?.key ?? 'heatmap'
  const params = (widget?.params as HeatmapWidgetParams | null | undefined) ?? null
  const sourceMode = resolveHeatmapSourceMode(params)

  return {
    left: <HeatmapMarketControls panelId={panelId} widgetKey={widgetKey} params={params} />,
    center: <HeatmapSourceControls panelId={panelId} widgetKey={widgetKey} params={params} />,
    right: (
      <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
        {sourceMode === 'portfolio' ? (
          <HeatmapPortfolioControls panelId={panelId} widgetKey={widgetKey} params={params} />
        ) : null}
        <HeatmapRefreshControl panelId={panelId} widgetKey={widgetKey} params={params} />
      </div>
    ),
  }
}
