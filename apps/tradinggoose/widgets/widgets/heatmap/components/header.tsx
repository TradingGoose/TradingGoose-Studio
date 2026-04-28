'use client'

import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitHeatmapParamsChange } from '@/widgets/utils/heatmap-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { MarketProviderSettingsButton } from '@/widgets/widgets/components/market-provider-settings-button'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
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
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: HeatmapWidgetParams | null
}

function HeatmapMarketControls({ workspaceId, panelId, widgetKey, params }: HeaderControlProps) {
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
    <div className={widgetHeaderButtonGroupClassName()}>
      <MarketProviderSettingsButton
        providerId={marketProviderId}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSave={({ providerParams, auth }) => {
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
      <MarketProviderSelector
        value={marketProviderId}
        options={marketProviderOptions}
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
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={() => {
              emitHeatmapParamsChange({
                params: { runtime: { refreshAt: Date.now() } },
                panelId,
                widgetKey,
              })
            }}
            aria-label='Refresh heatmap'
          >
            <RefreshCw className='h-3.5 w-3.5' />
            <span className='sr-only'>Refresh heatmap</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Refresh heatmap</TooltipContent>
      </Tooltip>
    </div>
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
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <TradingProviderSelector
        value={providerId || ''}
        options={providerOptions}
        onChange={(nextProvider) => {
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
      />
      {hasSelectedProvider ? (
        <TradingAccountSelector
          providerId={providerId || undefined}
          credentialProviderId={credentialProviderId}
          environmentOptions={environmentOptions}
          credentialId={params?.credentialId}
          environment={params?.environment}
          accountId={params?.accountId}
          placeholder='Select account'
          tooltipText='Select trading account'
          toolName='Heatmap'
          onAccountSelect={({ credentialId, environment, accountId }) => {
            emitHeatmapParamsChange({
              params: { credentialId, environment, accountId },
              panelId,
              widgetKey,
            })
          }}
        />
      ) : null}
    </div>
  )
}

export const renderHeatmapHeader: DashboardWidgetDefinition['renderHeader'] = ({
  context,
  panelId,
  widget,
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
    center: <HeatmapSourceControls panelId={panelId} widgetKey={widgetKey} params={params} />,
    right:
      sourceMode === 'portfolio' ? (
        <HeatmapPortfolioControls panelId={panelId} widgetKey={widgetKey} params={params} />
      ) : null,
  }
}
