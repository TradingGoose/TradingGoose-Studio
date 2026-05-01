'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitQuickOrderParamsChange } from '@/widgets/utils/quick-order-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import {
  getQuickOrderMarketProviderOptions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  resolveQuickOrderMarketProviderId,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderSide, QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/types'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: QuickOrderWidgetParams | null
}

export function QuickOrderHeaderControls({
  workspaceId,
  panelId,
  widgetKey,
  params,
}: HeaderControlProps) {
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
          emitQuickOrderParamsChange({
            params: {
              marketProvider: nextProvider,
              marketProviderParams: null,
              marketAuth: null,
            },
            panelId,
            widgetKey,
          })
        }}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSettingsSave={({ providerParams, auth }) => {
          emitQuickOrderParamsChange({
            params: {
              marketProviderParams: providerParams,
              marketAuth: auth,
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
          accountId={params?.accountId}
          toolName='Quick Order'
          onProviderChange={(nextProvider) => {
            if (!nextProvider || nextProvider === providerId) return

            emitQuickOrderParamsChange({
              params: {
                provider: nextProvider,
                accountId: null,
              },
              panelId,
              widgetKey,
            })
          }}
          onAccountSelect={({ accountId }) => {
            emitQuickOrderParamsChange({
              params: { accountId },
              panelId,
              widgetKey,
            })
          }}
        />
      ) : null}
    </div>
  )
}

function QuickOrderSideTabs({ panelId, widgetKey, params }: HeaderControlProps) {
  const side = params?.side === 'sell' ? 'sell' : 'buy'
  const sides: Array<{ id: QuickOrderSide; label: string }> = [
    { id: 'buy', label: 'BUY' },
    { id: 'sell', label: 'SELL' },
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
            className='h-5 min-w-14 px-3 rounded-xs text-sm'
            onClick={() => {
              if (option.id === side) return
              emitQuickOrderParamsChange({
                params: { side: option.id },
                panelId,
                widgetKey,
              })
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
