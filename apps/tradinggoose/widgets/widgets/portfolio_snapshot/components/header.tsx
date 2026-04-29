'use client'

import { useEffect, useMemo } from 'react'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitPortfolioSnapshotParamsChange } from '@/widgets/utils/portfolio-snapshot-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
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
  panelId?: string
  widgetKey: string
  params: PortfolioSnapshotWidgetParams | null
}

export function PortfolioSnapshotHeaderControls({
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

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <MarketProviderControls
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
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        onSettingsSave={({ providerParams, auth }) => {
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

      {areProviderOptionsReady ? (
        <TradingProviderControls
          providerId={providerId}
          providerOptions={providerOptions}
          credentialProviderId={credentialProviderId}
          environmentOptions={environmentOptions}
          credentialId={params?.credentialId}
          environment={params?.environment}
          accountId={params?.accountId}
          toolName='Portfolio Snapshot'
          onProviderChange={(nextProvider) => {
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
          onAccountSelect={({ credentialId, environment, accountId }) => {
            emitPortfolioSnapshotParamsChange({
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

function PortfolioSnapshotRefreshControl({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerId = typeof params?.provider === 'string' ? params.provider.trim() : ''

  return (
    <WidgetHeaderRefreshButton
      label='Refresh portfolio snapshot'
      disabled={!providerId}
      onClick={() => {
        if (!providerId) return
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
    />
  )
}

export const renderPortfolioSnapshotHeader: DashboardWidgetDefinition['renderHeader'] = ({
  panelId,
  widget,
}) => {
  const widgetKey = widget?.key ?? 'portfolio_snapshot'
  const params = (widget?.params as PortfolioSnapshotWidgetParams | null | undefined) ?? null

  return {
    left: (
      <PortfolioSnapshotHeaderControls panelId={panelId} widgetKey={widgetKey} params={params} />
    ),
    right: (
      <PortfolioSnapshotRefreshControl panelId={panelId} widgetKey={widgetKey} params={params} />
    ),
  }
}
