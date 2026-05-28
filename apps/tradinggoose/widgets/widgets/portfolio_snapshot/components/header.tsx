'use client'

import { useMemo } from 'react'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { TradingProviderControls } from '@/components/trading-selector/provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useLocale } from 'next-intl'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { useAppMessages } from '@/i18n/client-messages'
import type { LocaleCode } from '@/i18n/utils'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitPortfolioSnapshotParamsChange } from '@/widgets/utils/portfolio-snapshot-params'
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
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages().workspace.widgets.portfolioSnapshot.header
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
          providerId={providerId}
          providerOptions={providerOptions}
          serviceId={params?.serviceId}
          portfolioIdentity={params?.portfolioIdentity}
          toolName={copy.title}
          onProviderChange={(nextProvider) => {
            if (!nextProvider || nextProvider === providerId) return

            emitPortfolioSnapshotParamsChange({
              params: {
                provider: nextProvider,
                serviceId: null,
                portfolioIdentity: null,
                selectedWindow: null,
              },
              panelId,
              widgetKey,
            })
          }}
          onAccountSelect={({ serviceId, portfolioIdentity }) => {
            emitPortfolioSnapshotParamsChange({
              params: {
                portfolioIdentity,
                ...(serviceId ? { serviceId } : {}),
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
  const locale = useLocale() as LocaleCode
  const copy = useAppMessages().workspace.widgets.portfolioSnapshot.header
  const providerId = typeof params?.provider === 'string' ? params.provider.trim() : ''

  return (
    <WidgetHeaderRefreshButton
      label={copy.refresh}
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
