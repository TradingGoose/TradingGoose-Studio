'use client'

import { useMemo } from 'react'
import { useMessages } from 'next-intl'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { TradingProviderControls } from '@/components/trading-selector/provider-controls'
import { Button } from '@/components/ui/button'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
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
import type { HeatmapWidgetParams } from '@/widgets/widgets/heatmap/contract'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: HeatmapWidgetParams | null
}

const usePatchHeatmapParams = () => {
  const actions = useWidgetConfigRuntimeActions()
  return actions.patchWidgetParams
}

function HeatmapMarketControls({ workspaceId, panelId, widgetKey, params }: HeaderControlProps) {
  const marketProviderOptions = useMemo(() => getHeatmapMarketProviderOptions(), [])
  const marketProviderId = resolveHeatmapMarketProviderId(params, marketProviderOptions)
  const patchParams = usePatchHeatmapParams()

  return (
    <MarketProviderControls
      value={marketProviderId}
      options={marketProviderOptions}
      providerParams={params?.marketProviderParams}
      authParams={params?.marketAuth}
      workspaceId={workspaceId}
      onChange={(nextProvider) => {
        if (!nextProvider || nextProvider === marketProviderId) return
        patchParams({
          marketProvider: nextProvider,
          marketProviderParams: null,
          marketAuth: null,
          runtime: { refreshAt: Date.now() },
        })
      }}
      onSettingsSave={({ providerParams, auth }) => {
        patchParams({
          marketProviderParams: providerParams,
          marketAuth: auth,
          runtime: { refreshAt: Date.now() },
        })
      }}
    />
  )
}

function HeatmapSourceControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const sourceMode = resolveHeatmapSourceMode(params)
  const patchParams = usePatchHeatmapParams()

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
              patchParams({ sourceMode: mode.id })
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
  const patchParams = usePatchHeatmapParams()

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
              patchParams({ watchlistSizeMetric: metric.id })
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
  const copy = useMessages().workspace.widgets.heatmap.header
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getHeatmapTradingProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getHeatmapTradingProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveHeatmapTradingProviderId(params, providerOptions)
  const patchParams = usePatchHeatmapParams()

  return (
    <TradingProviderControls
      providerId={providerId}
      providerOptions={providerOptions}
      serviceId={params?.serviceId}
      portfolioIdentity={params?.portfolioIdentity}
      toolName={copy.title}
      onProviderChange={(nextProvider) => {
        if (!nextProvider || nextProvider === providerId) return
        patchParams({
          tradingProvider: nextProvider,
          serviceId: null,
          portfolioIdentity: null,
        })
      }}
      onAccountSelect={({ serviceId, portfolioIdentity }) => {
        patchParams({
          portfolioIdentity,
          ...(serviceId ? { serviceId } : {}),
        })
      }}
    />
  )
}

function HeatmapRefreshControl({ panelId, widgetKey }: HeaderControlProps) {
  const patchParams = usePatchHeatmapParams()
  return (
    <WidgetHeaderRefreshButton
      label='Refresh heatmap'
      onClick={() => {
        patchParams({ runtime: { refreshAt: Date.now() } })
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
