'use client'

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitQuickOrderParamsChange } from '@/widgets/utils/quick-order-params'
import { TradingProviderControls } from '@/widgets/widgets/components/trading-provider-controls'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import {
  getQuickOrderEnvironmentOptions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  resolveQuickOrderCredentialProvider,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderSide, QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/types'

type HeaderControlProps = {
  panelId?: string
  widgetKey: string
  params: QuickOrderWidgetParams | null
}

export function QuickOrderHeaderControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getQuickOrderProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getQuickOrderProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveQuickOrderProviderId(params?.provider, providerAvailabilityQuery.data)
  const hasSelectedProvider = Boolean(providerId)
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolveQuickOrderCredentialProvider(providerId)
      : undefined
  const environmentOptions = useMemo(
    () =>
      hasSelectedProvider
        ? getQuickOrderEnvironmentOptions(providerId).map((environment) => ({
          id: environment,
          label: environment === 'paper' ? 'Paper' : 'Live',
        }))
        : [],
    [hasSelectedProvider, providerId]
  )

  if (!areProviderOptionsReady) {
    return <div className={widgetHeaderButtonGroupClassName()} />
  }

  return (
    <TradingProviderControls
      providerId={providerId}
      providerOptions={providerOptions}
      credentialProviderId={credentialProviderId}
      environmentOptions={environmentOptions}
      credentialId={params?.credentialId}
      environment={params?.environment}
      accountId={params?.accountId}
      toolName='Quick Order'
      onProviderChange={(nextProvider) => {
        if (!nextProvider || nextProvider === providerId) return

        emitQuickOrderParamsChange({
          params: {
            provider: nextProvider,
            credentialId: null,
            environment: null,
            accountId: null,
          },
          panelId,
          widgetKey,
        })
      }}
      onAccountSelect={({ credentialId, environment, accountId }) => {
        emitQuickOrderParamsChange({
          params: { credentialId, environment, accountId },
          panelId,
          widgetKey,
        })
      }}
    />
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
}) => ({
  left: (
    <QuickOrderHeaderControls
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
