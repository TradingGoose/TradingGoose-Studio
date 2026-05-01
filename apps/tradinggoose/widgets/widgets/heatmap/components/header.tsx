'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitHeatmapParamsChange } from '@/widgets/utils/heatmap-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import {
  getHeatmapMarketProviderOptions,
  getHeatmapTradingProviderAvailabilityIds,
  getHeatmapTradingProviderOptions,
  HEATMAP_SOURCE_MODES,
  HEATMAP_WATCHLIST_SIZE_METRICS,
  resolveHeatmapMarketProviderId,
  resolveHeatmapSourceMode,
  resolveHeatmapTradingProviderId,
  resolveHeatmapWatchlistSizeMetric,
} from '@/widgets/widgets/heatmap/components/shared'
import type { HeatmapWidgetParams } from '@/widgets/widgets/heatmap/types'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: HeatmapWidgetParams | null
}

function HeatmapMarketControls({ workspaceId, panelId, widgetKey, params }: HeaderControlProps) {
  const marketProviderOptions = useMemo(() => getHeatmapMarketProviderOptions(), [])
  const marketProviderId = resolveHeatmapMarketProviderId(params, marketProviderOptions)

  return (
    <MarketProviderControls
      value={marketProviderId}
      options={marketProviderOptions}
      providerParams={params?.marketProviderParams}
      authParams={params?.marketAuth}
      workspaceId={workspaceId}
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
    <div className='flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-card/60 p-1'>
      {HEATMAP_SOURCE_MODES.map((mode) => {
        const isSelected = mode.id === sourceMode

        return (
          <Button
            key={mode.id}
            type='button'
            variant={isSelected ? 'default' : 'ghost'}
            size='sm'
            className='h-5 min-w-14 rounded-xs px-3 text-sm'
            onClick={() => {
              if (mode.id === sourceMode) return
              emitHeatmapParamsChange({
                params: { sourceMode: mode.id },
                panelId,
                widgetKey,
              })
            }}
          >
            {mode.label}
          </Button>
        )
      })}
    </div>
  )
}

function HeatmapWatchlistSizeControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const sizeMetric = resolveHeatmapWatchlistSizeMetric(params)

  return (
    <div className='flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-card/60 p-1'>
      {HEATMAP_WATCHLIST_SIZE_METRICS.map((metric) => {
        const isSelected = metric.id === sizeMetric

        return (
          <Button
            key={metric.id}
            type='button'
            variant={isSelected ? 'default' : 'ghost'}
            size='sm'
            className='h-5 min-w-16 rounded-xs px-3 text-sm'
            onClick={() => {
              if (metric.id === sizeMetric) return
              emitHeatmapParamsChange({
                params: { watchlistSizeMetric: metric.id },
                panelId,
                widgetKey,
              })
            }}
          >
            {metric.label}
          </Button>
        )
      })}
    </div>
  )
}

function HeatmapPortfolioControls({ workspaceId, panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getHeatmapTradingProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getHeatmapTradingProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveHeatmapTradingProviderId(params, providerOptions)

  return (
    <TradingProviderControls
      workspaceId={workspaceId}
      providerId={providerId}
      providerOptions={providerOptions}
      accountId={params?.accountId}
      toolName='Heatmap'
      onProviderChange={(nextProvider) => {
        if (!nextProvider || nextProvider === providerId) return
        emitHeatmapParamsChange({
          params: {
            tradingProvider: nextProvider,
            accountId: null,
          },
          panelId,
          widgetKey,
        })
      }}
      onAccountSelect={({ accountId }) => {
        emitHeatmapParamsChange({
          params: { accountId },
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
  context,
}) => {
  const widgetKey = widget?.key ?? 'heatmap'
  const params = (widget?.params as HeatmapWidgetParams | null | undefined) ?? null
  const sourceMode = resolveHeatmapSourceMode(params)

  return {
    left: (
      <HeatmapMarketControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widgetKey={widgetKey}
        params={params}
      />
    ),
    center: (
      <div className='flex min-w-0 items-center gap-1'>
        <HeatmapSourceControls panelId={panelId} widgetKey={widgetKey} params={params} />
        {sourceMode === 'watchlist' ? (
          <HeatmapWatchlistSizeControls panelId={panelId} widgetKey={widgetKey} params={params} />
        ) : null}
      </div>
    ),
    right: (
      <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
        {sourceMode === 'portfolio' ? (
          <HeatmapPortfolioControls
            workspaceId={context?.workspaceId}
            panelId={panelId}
            widgetKey={widgetKey}
            params={params}
          />
        ) : null}
        <HeatmapRefreshControl panelId={panelId} widgetKey={widgetKey} params={params} />
      </div>
    ),
  }
}
