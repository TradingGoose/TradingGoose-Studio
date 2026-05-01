'use client'

import { useMemo } from 'react'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitPortfolioSnapshotParamsChange } from '@/widgets/utils/portfolio-snapshot-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import {
  getPortfolioSnapshotMarketProviderOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  resolvePortfolioSnapshotMarketProviderId,
  resolvePortfolioSnapshotProviderId,
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
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0

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
        workspaceId={workspaceId}
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
          workspaceId={workspaceId}
          providerId={providerId}
          providerOptions={providerOptions}
          credentialServiceId={params?.credentialServiceId}
          accountId={params?.accountId}
          toolName='Portfolio Snapshot'
          onProviderChange={(nextProvider) => {
            if (!nextProvider || nextProvider === providerId) return

            emitPortfolioSnapshotParamsChange({
              params: {
                provider: nextProvider,
                credentialServiceId: null,
                accountId: null,
                selectedWindow: null,
              },
              panelId,
              widgetKey,
            })
          }}
          onAccountSelect={({ accountId, credentialServiceId }) => {
            emitPortfolioSnapshotParamsChange({
              params: {
                accountId,
                ...(credentialServiceId ? { credentialServiceId } : {}),
              },
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
  context,
}) => {
  const widgetKey = widget?.key ?? 'portfolio_snapshot'
  const params = (widget?.params as PortfolioSnapshotWidgetParams | null | undefined) ?? null

  return {
    left: (
      <PortfolioSnapshotHeaderControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widgetKey={widgetKey}
        params={params}
      />
    ),
    right: (
      <PortfolioSnapshotRefreshControl panelId={panelId} widgetKey={widgetKey} params={params} />
    ),
  }
}
