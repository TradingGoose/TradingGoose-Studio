'use client'

import { useMemo } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { TradingProviderControls } from '@/components/trading-selector/provider-controls'
import { Button } from '@/components/ui/button'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { LocaleCode } from '@/i18n/utils'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import {
  getQuickOrderMarketProviderOptions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  resolveQuickOrderMarketProviderId,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderSide, QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/contract'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: QuickOrderWidgetParams | null
}

const usePatchQuickOrderParams = () => {
  const actions = useWidgetConfigRuntimeActions()
  return actions.patchWidgetParams
}

export function QuickOrderHeaderControls({
  workspaceId,
  panelId,
  widgetKey,
  params,
}: HeaderControlProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.quickOrder.header
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getQuickOrderProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getQuickOrderProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const marketProviderOptions = useMemo(() => getQuickOrderMarketProviderOptions(), [])
  const providerId = resolveQuickOrderProviderId(params?.provider, providerAvailabilityQuery.data)
  const marketProviderId = resolveQuickOrderMarketProviderId(params, marketProviderOptions)
  const patchParams = usePatchQuickOrderParams()
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
          })
        }}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSettingsSave={({ providerParams, auth }) => {
          patchParams({
            marketProviderParams: providerParams,
            marketAuth: auth,
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

function QuickOrderSideTabs({ panelId, widgetKey, params }: HeaderControlProps) {
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.quickOrder.header
  const patchParams = usePatchQuickOrderParams()
  const side = params?.side === 'sell' ? 'sell' : 'buy'
  const sides: Array<{ id: QuickOrderSide; label: string }> = [
    { id: 'buy', label: copy.buy },
    { id: 'sell', label: copy.sell },
  ]

  return (
    <div className='flex h-7 items-center gap-1 rounded-sm border border-border/70 bg-card/60 p-1'>
      {sides.map((option) => {
        const isSelected = option.id === side

        return (
          <Button
            key={option.id}
            type='button'
            variant={isSelected ? 'default' : 'ghost'}
            size='sm'
            className='h-5 min-w-14 rounded-xs px-3 text-sm'
            onClick={() => {
              if (option.id === side) return
              patchParams({ side: option.id })
            }}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

export const renderQuickOrderHeader: DashboardWidgetDefinition['renderHeader'] = ({
  panelId,
  widget,
  context,
}) => ({
  left: (
    <QuickOrderHeaderControls
      workspaceId={context?.workspaceId}
      panelId={panelId}
      widgetKey={widget?.key ?? 'quick_order'}
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
  center: (
    <QuickOrderSideTabs
      panelId={panelId}
      widgetKey={widget?.key ?? 'quick_order'}
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
})
