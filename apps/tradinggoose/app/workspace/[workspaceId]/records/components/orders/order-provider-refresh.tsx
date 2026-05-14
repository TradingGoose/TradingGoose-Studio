'use client'

import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useProviderOrderDetail } from '@/hooks/queries/records-orders'
import { getTradingProviderOAuthServiceIds } from '@/providers/trading/providers'
import type { TradingProviderId } from '@/providers/trading/types'
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

  const providerDetailQuery = useProviderOrderDetail({
    workspaceId,
    orderId: order.id,
    enabled: false,
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
      <Button
        size='sm'
        className='gap-2'
        disabled={!active || providerDetailQuery.isFetching}
        onClick={() => void providerDetailQuery.refetch()}
      >
        {providerDetailQuery.isFetching ? (
          <Loader2 className='h-4 w-4 animate-spin' />
        ) : (
          <RefreshCw className='h-4 w-4' />
        )}
        Refresh provider detail
      </Button>

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
