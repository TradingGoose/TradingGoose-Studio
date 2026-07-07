'use client'

import { useMemo } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { TradingProviderControls } from '@/components/trading-selector/provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { LocaleCode } from '@/i18n/utils'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/contract'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import {
  getPortfolioSnapshotMarketProviderOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  resolvePortfolioSnapshotMarketProviderId,
  resolvePortfolioSnapshotProviderId,
} from '@/widgets/widgets/portfolio_snapshot/components/shared'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: PortfolioSnapshotWidgetParams | null
}

const usePatchPortfolioSnapshotParams = (panelId: string | undefined, widgetKey: string) => {
  const actions = useWidgetConfigRuntimeActions()
  return (params: Record<string, unknown>) => {
    if (!panelId) return
    actions.patchWidgetParams(panelId, widgetKey, params)
  }
}

export function PortfolioSnapshotHeaderControls({
  workspaceId,
  panelId,
  widgetKey,
  params,
}: HeaderControlProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.portfolioSnapshot.header
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
  const patchParams = usePatchPortfolioSnapshotParams(panelId, widgetKey)
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
          patchParams({
            marketProvider: nextProvider,
            marketProviderParams: null,
            marketAuth: null,
            runtime: { refreshAt: Date.now() },
          })
        }}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSettingsSave={({ providerParams, auth }) => {
          patchParams({
            marketProviderParams: providerParams,
            marketAuth: auth,
            runtime: { refreshAt: Date.now() },
          })
        }}
      />

      {areProviderOptionsReady ? (
        <TradingProviderControls
          providerId={providerId}
          providerOptions={providerOptions}
          serviceId={params?.serviceId}
          portfolioIdentity={params?.portfolioIdentity}
          toolName={copy.title}
          onProviderChange={(nextProvider) => {
            if (!nextProvider || nextProvider === providerId) return

            patchParams({
              provider: nextProvider,
              serviceId: null,
              portfolioIdentity: null,
              selectedWindow: null,
            })
          }}
          onAccountSelect={({ serviceId, portfolioIdentity }) => {
            patchParams({
              portfolioIdentity,
              ...(serviceId ? { serviceId } : {}),
            })
          }}
        />
      ) : null}
    </div>
  )
}

function PortfolioSnapshotRefreshControl({ panelId, widgetKey, params }: HeaderControlProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.portfolioSnapshot.header
  const providerId = typeof params?.provider === 'string' ? params.provider.trim() : ''
  const patchParams = usePatchPortfolioSnapshotParams(panelId, widgetKey)

  return (
    <WidgetHeaderRefreshButton
      label={copy.refresh}
      disabled={!providerId}
      onClick={() => {
        if (!providerId) return
        patchParams({
          runtime: {
            refreshAt: Date.now(),
          },
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
