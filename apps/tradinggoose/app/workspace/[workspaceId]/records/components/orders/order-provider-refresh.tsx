'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useProviderOrderDetail } from '@/hooks/queries/records-orders'
import { useTradingAccounts } from '@/hooks/queries/trading-portfolio'
import { getTradingProviderOAuthServiceId } from '@/providers/trading/providers'
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
  const credentialProviderId = getTradingProviderOAuthServiceId(order.provider as TradingProviderId)
  const credentialsQuery = useOAuthCredentials(credentialProviderId ?? undefined, active)
  const credentials = credentialsQuery.data ?? []
  const [credentialId, setCredentialId] = useState('')
  const [environment, setEnvironment] = useState(order.environment ?? 'paper')
  const [accountId, setAccountId] = useState(order.accountId ?? '')
  const [requested, setRequested] = useState(false)

  useEffect(() => {
    if (!credentialId && credentials.length === 1 && credentials[0]?.id) {
      setCredentialId(credentials[0].id)
    }
  }, [credentialId, credentials])

  useEffect(() => {
    setEnvironment(order.environment ?? 'paper')
    setAccountId(order.accountId ?? '')
    setRequested(false)
  }, [order.id, order.environment, order.accountId])

  const accountsQuery = useTradingAccounts({
    provider: order.provider,
    credentialId,
    environment,
  })
  const accounts = accountsQuery.data ?? []

  useEffect(() => {
    if (!accountId && accounts.length === 1 && accounts[0]?.id) {
      setAccountId(accounts[0].id)
    }
  }, [accountId, accounts])

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

  const credentialItems = useMemo(
    () => credentials.map((credential) => ({ id: credential.id, name: credential.name })),
    [credentials]
  )

  if (!credentialProviderId) {
    return (
      <div className='rounded-md border bg-card/40 p-4 text-muted-foreground text-sm'>
        Provider refresh is unavailable for this provider.
      </div>
    )
  }

  return (
    <div className='space-y-4'>
      <div className='grid gap-3 md:grid-cols-[1fr_140px]'>
        <Select
          value={credentialId || 'none'}
          onValueChange={(value) => setCredentialId(value === 'none' ? '' : value)}
        >
          <SelectTrigger className='h-9 rounded-md bg-background'>
            <SelectValue placeholder='Select credential' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='none'>Select credential</SelectItem>
            {credentialItems.map((credential) => (
              <SelectItem key={credential.id} value={credential.id}>
                {credential.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={environment} onValueChange={setEnvironment}>
          <SelectTrigger className='h-9 rounded-md bg-background'>
            <SelectValue placeholder='Environment' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='paper'>Paper</SelectItem>
            <SelectItem value='live'>Live</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <TradingAccountSelector
        accountId={accountId}
        accounts={accounts}
        isAccountsLoading={accountsQuery.isLoading}
        accountsError={accountsQuery.error}
        disabled={!credentialId || !environment}
        placeholder={providerRequiresAccount ? 'Select account' : 'Optional account'}
        onAccountSelect={setAccountId}
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

      {credentialsQuery.isLoading ? (
        <p className='text-muted-foreground text-sm'>Loading credentials...</p>
      ) : credentialsQuery.error ? (
        <p className='text-destructive text-sm'>Unable to load trading credentials.</p>
      ) : !credentialId ? (
        <p className='text-muted-foreground text-sm'>
          Select a credential to fetch live provider detail.
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
