'use client'

import { useMemo } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { useMessages } from 'next-intl'
import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { TradingProviderControls } from '@/components/trading-selector/provider-controls'
import { Button } from '@/components/ui/button'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import {
  getQuickOrderMarketProviderOptions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  getQuickOrderSubmitMutationKey,
  resolveQuickOrderMarketProviderId,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderSide, QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/contract'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  params: QuickOrderWidgetParams | null
}

const usePatchQuickOrderParams = () => {
  const actions = useWidgetConfigRuntimeActions()
  return actions.patchWidgetParams
}

export function QuickOrderHeaderControls({ workspaceId, panelId, params }: HeaderControlProps) {
  const copy = useMessages().workspace.widgets.quickOrder.header
  const mutationKey = getQuickOrderSubmitMutationKey(panelId)
  const isPending = useIsMutating({ mutationKey, exact: true }) > 0
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
  if (!patchParams) return null

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <MarketProviderControls
        value={marketProviderId}
        options={marketProviderOptions}
        disabled={isPending}
        onChange={(nextProvider) => {
          if (isPending || !nextProvider || nextProvider === marketProviderId) return
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
          if (isPending) return
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
          disabled={isPending}
          onProviderChange={(nextProvider) => {
            if (isPending || !nextProvider || nextProvider === providerId) return

            patchParams({
              provider: nextProvider,
              serviceId: null,
              portfolioIdentity: null,
            })
          }}
          onAccountSelect={({ serviceId, portfolioIdentity }) => {
            if (isPending) return
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

function QuickOrderSideTabs({ panelId, params }: HeaderControlProps) {
  const copy = useMessages().workspace.widgets.quickOrder.header
  const mutationKey = getQuickOrderSubmitMutationKey(panelId)
  const isPending = useIsMutating({ mutationKey, exact: true }) > 0
  const patchParams = usePatchQuickOrderParams()
  const side = params?.side === 'sell' ? 'sell' : 'buy'
  const sides: Array<{ id: QuickOrderSide; label: string }> = [
    { id: 'buy', label: copy.buy },
    { id: 'sell', label: copy.sell },
  ]
  if (!patchParams) return null

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
            disabled={isPending}
            onClick={() => {
              if (isPending || option.id === side) return
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
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
  center: (
    <QuickOrderSideTabs
      panelId={panelId}
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
})
