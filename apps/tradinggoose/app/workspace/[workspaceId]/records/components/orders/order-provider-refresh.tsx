'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProviderOrderDetail } from '@/hooks/queries/records-orders'
import {
  getTradingProviderOAuthServiceId,
  getTradingProviderParamDefinitions,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import {
  TradingAccountSelector,
  type TradingEnvironmentOption,
} from '@/widgets/widgets/components/trading-account-selector'
import type { RecordsOrder } from './types'

const isTradingEnvironmentOption = (option: {
  id: string
  label: string
}): option is TradingEnvironmentOption => option.id === 'paper' || option.id === 'live'

export function OrderProviderRefresh({
  workspaceId,
  order,
  active,
}: {
  workspaceId: string
  order: RecordsOrder
  active: boolean
}) {
  const providerId = order.provider as TradingProviderId
  const credentialProviderId = getTradingProviderOAuthServiceId(providerId)
  const [credentialId, setCredentialId] = useState('')
  const [environment, setEnvironment] = useState(order.environment ?? 'paper')
  const [accountId, setAccountId] = useState(order.accountId ?? '')
  const [requested, setRequested] = useState(false)
  const environmentOptions = useMemo(
    () =>
      getTradingProviderParamDefinitions(providerId, 'order')
        .find((definition) => definition.id === 'environment')
        ?.options?.filter(isTradingEnvironmentOption) ?? [],
    [providerId]
  )

  useEffect(() => {
    setCredentialId('')
    setEnvironment(order.environment ?? 'paper')
    setAccountId(order.accountId ?? '')
    setRequested(false)
  }, [order.id, order.environment, order.accountId])

  const providerRequiresAccount = order.provider === 'tradier'
  const canRefresh = Boolean(
    active &&
      credentialId &&
      environment &&
      (!providerRequiresAccount || accountId || order.accountId)
  )

  const providerDetailQuery = useProviderOrderDetail({
    workspaceId,
    orderId: order.id,
    credentialId,
    environment,
    accountId: accountId || order.accountId || undefined,
    enabled: active && requested && canRefresh,
  })

  if (!credentialProviderId) {
    return (
      <div className='rounded-md border bg-card/40 p-4 text-muted-foreground text-sm'>
        Provider refresh is unavailable for this provider.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <TradingAccountSelector
        providerId={providerId}
        credentialProviderId={credentialProviderId}
        environmentOptions={environmentOptions}
        credentialId={credentialId}
        environment={environment}
        accountId={accountId}
        disabled={!active}
        placeholder={providerRequiresAccount ? 'Select account' : 'Optional account'}
        tooltipText='Select provider refresh account'
        toolName='Provider Detail Refresh'
        onAccountSelect={(selection) => {
          setCredentialId(selection.credentialId)
          setEnvironment(selection.environment)
          setAccountId(selection.accountId)
          setRequested(false)
        }}
      />

      <Button
        size='sm'
        className='gap-2'
        disabled={!canRefresh || providerDetailQuery.isFetching}
        onClick={() => setRequested(true)}
      >
        {providerDetailQuery.isFetching ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <RefreshCw className='h-4 w-4' />
        )}
        Refresh provider detail
      </Button>

      {!credentialId ? (
        <p className='text-muted-foreground text-sm'>
          Select a broker account to fetch live provider detail.
        </p>
      ) : providerRequiresAccount && !accountId ? (
        <p className='text-muted-foreground text-sm'>
          Select an account to fetch Tradier order detail.
        </p>
      ) : null}

      {providerDetailQuery.error ? (
        <p className='text-destructive text-sm'>
          {providerDetailQuery.error instanceof Error
            ? providerDetailQuery.error.message
            : 'Provider detail refresh failed.'}
        </p>
      ) : null}

      {providerDetailQuery.data ? (
        <pre className='max-h-[420px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs'>
          {JSON.stringify(providerDetailQuery.data, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}
