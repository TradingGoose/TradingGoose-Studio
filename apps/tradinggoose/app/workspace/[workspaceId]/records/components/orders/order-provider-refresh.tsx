'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProviderOrderDetail } from '@/hooks/queries/records-orders'
import {
  getTradingProviderOAuthServiceIdForEnvironment,
  getTradingProviderOAuthServiceIds,
} from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import type { RecordsOrder } from './types'

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
  const oauthServiceIds = getTradingProviderOAuthServiceIds(providerId)
  const credentialServiceId = getTradingProviderOAuthServiceIdForEnvironment(
    providerId,
    order.environment
  )
  const [accountId, setAccountId] = useState(order.accountId ?? '')
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    setAccountId(order.accountId ?? '')
    setRequested(false)
  }, [order.id, order.accountId])

  const providerRequiresAccount = order.provider === 'tradier'
  const canRefresh = Boolean(active && (!providerRequiresAccount || accountId || order.accountId))

  const providerDetailQuery = useProviderOrderDetail({
    workspaceId,
    orderId: order.id,
    accountId: accountId || order.accountId || undefined,
    enabled: active && requested && canRefresh,
  })

  if (oauthServiceIds.length === 0) {
    return (
      <div className='rounded-md border bg-card/40 p-4 text-muted-foreground text-sm'>
        Provider refresh is unavailable for this provider.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <TradingAccountSelector
        workspaceId={workspaceId}
        providerId={providerId}
        credentialServiceId={credentialServiceId}
        accountId={accountId}
        disabled={!active}
        placeholder={providerRequiresAccount ? 'Select account' : 'Optional account'}
        tooltipText='Select provider refresh account'
        toolName='Provider Detail Refresh'
        onAccountSelect={(selection) => {
          setAccountId(selection.accountId ?? '')
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

      {providerRequiresAccount && !accountId ? (
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
