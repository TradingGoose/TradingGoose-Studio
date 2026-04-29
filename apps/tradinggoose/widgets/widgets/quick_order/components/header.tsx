'use client'

import { useMemo } from 'react'
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
    <div className='flex h-8 overflow-hidden rounded-md border border-border/70 bg-card/60 p-0.5'>
      {sides.map((option) => {
        const isSelected = option.id === side

        return (
          <button
            key={option.id}
            type='button'
            className={`min-w-14 rounded-sm border px-3 text-center font-semibold text-[11px] transition-colors ${
              isSelected
                ? option.id === 'buy'
                  ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-rose-400/60 bg-rose-500/15 text-rose-300'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
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
          </button>
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
