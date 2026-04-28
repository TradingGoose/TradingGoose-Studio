'use client'

import { useEffect, useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitPortfolioSnapshotParamsChange } from '@/widgets/utils/portfolio-snapshot-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { MarketProviderSettingsButton } from '@/widgets/widgets/components/market-provider-settings-button'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import {
  getPortfolioSnapshotEnvironmentOptions,
  getPortfolioSnapshotMarketProviderOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  resolvePortfolioSnapshotCredentialProvider,
  resolvePortfolioSnapshotMarketProviderId,
  resolvePortfolioSnapshotProviderId,
  shouldPersistPortfolioSnapshotMarketProviderDefault,
} from '@/widgets/widgets/portfolio_snapshot/components/shared'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: PortfolioSnapshotWidgetParams | null
}

export function PortfolioSnapshotHeaderControls({
  workspaceId,
  panelId,
  widgetKey,
  params,
}: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getPortfolioSnapshotProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getPortfolioSnapshotProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const marketProviderOptions = useMemo(() => getPortfolioSnapshotMarketProviderOptions(), [])
  const providerId = resolvePortfolioSnapshotProviderId(params, providerOptions)
  const marketProviderId = resolvePortfolioSnapshotMarketProviderId(params, marketProviderOptions)
  const hasSelectedProvider = Boolean(providerId)
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolvePortfolioSnapshotCredentialProvider(providerId)
      : undefined
  const environmentOptions = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )

  useEffect(() => {
    if (!shouldPersistPortfolioSnapshotMarketProviderDefault(params, marketProviderId)) return
    emitPortfolioSnapshotParamsChange({
      params: { marketProvider: marketProviderId },
      panelId,
      widgetKey,
    })
  }, [marketProviderId, panelId, params, widgetKey])

  if (!areProviderOptionsReady) {
    return <div className={widgetHeaderButtonGroupClassName()} />
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <MarketProviderSettingsButton
        providerId={marketProviderId}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSave={({ providerParams, auth }) => {
          emitPortfolioSnapshotParamsChange({
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
          emitPortfolioSnapshotParamsChange({
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

      <TradingProviderSelector
        value={providerId || ''}
        options={providerOptions}
        onChange={(nextProvider) => {
          if (!nextProvider || nextProvider === providerId) return

          emitPortfolioSnapshotParamsChange({
            params: {
              provider: nextProvider,
              credentialId: null,
              environment: null,
              accountId: null,
              selectedWindow: null,
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
          toolName='Portfolio Snapshot'
          onAccountSelect={({ credentialId, environment, accountId }) => {
            emitPortfolioSnapshotParamsChange({
              params: { credentialId, environment, accountId },
              panelId,
              widgetKey,
            })
          }}
        />
      ) : null}

      {providerId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={() => {
                emitPortfolioSnapshotParamsChange({
                  params: {
                    runtime: {
                      refreshAt: Date.now(),
                    },
                  },
                  panelId,
                  widgetKey,
                })
              }}
              aria-label='Refresh portfolio snapshot'
            >
              <RefreshCw className='h-3.5 w-3.5' />
              <span className='sr-only'>Refresh portfolio snapshot</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>Refresh portfolio snapshot</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

export const renderPortfolioSnapshotHeader: DashboardWidgetDefinition['renderHeader'] = ({
  context,
  panelId,
  widget,
}) => ({
  left: (
    <PortfolioSnapshotHeaderControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widgetKey={widget?.key ?? 'portfolio_snapshot'}
      params={(widget?.params as PortfolioSnapshotWidgetParams | null | undefined) ?? null}
    />
  ),
})
