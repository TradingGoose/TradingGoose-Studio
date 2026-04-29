'use client'

import { useMemo, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, ChevronDown, Plus, RefreshCw } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { fetchTradingAccounts, tradingPortfolioQueryKeys } from '@/hooks/queries/trading-portfolio'
import type { Credential } from '@/lib/oauth'
import { cn } from '@/lib/utils'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { UnifiedTradingAccount } from '@/providers/trading/types'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import { resolveTradingProviderIcon } from '@/widgets/widgets/components/trading-provider-selector'

export type TradingEnvironmentOption = {
  id: 'paper' | 'live'
  label: string
}

export type TradingAccountSelection = {
  credentialId: string
  environment: 'paper' | 'live'
  accountId: string
}

type TradingAccountOption = TradingAccountSelection & {
  key: string
  account: UnifiedTradingAccount
  credential: Credential
  environmentLabel: string
}

type TradingAccountRequest = {
  credential: Credential
  environment: 'paper' | 'live'
  environmentLabel: string
}

type TradingAccountSelectorProps = {
  providerId?: string | null
  credentialProviderId?: string
  environmentOptions: TradingEnvironmentOption[]
  credentialId?: string | null
  environment?: string | null
  accountId?: string | null
  disabled?: boolean
  placeholder?: string
  tooltipText?: string
  toolName?: string
  onAccountSelect?: (selection: TradingAccountSelection) => void
}

const getAccountName = (account: UnifiedTradingAccount) => account.name ?? account.id

const buildAccountOptionKey = ({ credentialId, environment, accountId }: TradingAccountSelection) =>
  `${credentialId}:${environment}:${accountId}`

export function TradingAccountSelector({
  providerId,
  credentialProviderId,
  environmentOptions,
  credentialId,
  environment,
  accountId,
  disabled = false,
  placeholder = 'Select account',
  tooltipText = 'Select trading account',
  toolName = 'Trading',
  onAccountSelect,
}: TradingAccountSelectorProps) {
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const providerName = providerDefinition?.name ?? 'broker'
  const oauthProvider = providerDefinition?.oauth?.provider
  const resolvedCredentialProviderId =
    credentialProviderId ??
    providerDefinition?.oauth?.serviceId ??
    providerDefinition?.oauth?.provider
  const isEnabled = Boolean(trimmedProviderId) && !disabled
  const credentialsQuery = useOAuthCredentials(resolvedCredentialProviderId, isEnabled)
  const credentials = credentialsQuery.data ?? []
  const normalizedEnvironmentOptions = useMemo(
    () => environmentOptions.filter((option) => option.id === 'paper' || option.id === 'live'),
    [environmentOptions]
  )
  const accountRequests = useMemo<TradingAccountRequest[]>(
    () =>
      isEnabled
        ? credentials.flatMap((credential) =>
          normalizedEnvironmentOptions.map((environmentOption) => ({
            credential,
            environment: environmentOption.id,
            environmentLabel: environmentOption.label,
          }))
        )
        : [],
    [credentials, isEnabled, normalizedEnvironmentOptions]
  )
  const accountQueries = useQueries({
    queries: accountRequests.map((request) => ({
      queryKey: tradingPortfolioQueryKeys.accounts({
        provider: trimmedProviderId,
        credentialId: request.credential.id,
        environment: request.environment,
      }),
      queryFn: () =>
        fetchTradingAccounts({
          provider: trimmedProviderId,
          credentialId: request.credential.id,
          environment: request.environment,
        }),
      enabled: isEnabled,
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
    })),
  })
  const accountOptions = accountRequests.flatMap((request, index): TradingAccountOption[] => {
    const accounts = (accountQueries[index]?.data ?? []) as UnifiedTradingAccount[]
    return accounts.map((account) => ({
      key: buildAccountOptionKey({
        credentialId: request.credential.id,
        environment: request.environment,
        accountId: account.id,
      }),
      credentialId: request.credential.id,
      environment: request.environment,
      accountId: account.id,
      account,
      credential: request.credential,
      environmentLabel: request.environmentLabel,
    }))
  })
  const selectedEnvironment =
    environment === 'paper' || environment === 'live' ? environment : undefined
  const selectedKey =
    credentialId && selectedEnvironment && accountId
      ? buildAccountOptionKey({
        credentialId,
        environment: selectedEnvironment,
        accountId,
      })
      : ''
  const selectedOption = accountOptions.find((option) => option.key === selectedKey) ?? null
  const buttonLabel = selectedOption
    ? getAccountName(selectedOption.account)
    : accountId
      ? accountId
      : placeholder
  const isLoadingAccounts =
    credentialsQuery.isLoading ||
    accountQueries.some((query) => query.isLoading || query.isFetching)
  const hasAccountRequestError = accountQueries.some((query) => query.error)
  const ProviderIcon = resolveTradingProviderIcon(trimmedProviderId)

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    void credentialsQuery.refetch()
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className='inline-flex'>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  disabled={!isEnabled}
                  className={widgetHeaderControlClassName(
                    'group flex justify-between gap-2'
                  )}
                  aria-haspopup='listbox'
                  aria-label='Select trading account'
                >
                  <span className='flex min-w-0 items-center gap-1.5'>
                    {ProviderIcon ? (
                      <ProviderIcon
                        className='h-4 w-4 shrink-0 text-muted-foreground'
                        aria-hidden='true'
                      />
                    ) : null}
                    <span
                      className={cn(
                        'min-w-0 text-left',
                        selectedOption ? 'font-medium text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {buttonLabel}
                    </span>
                  </span>
                  <ChevronDown
                    className='h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                    aria-hidden='true'
                  />
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{tooltipText}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-[320px] p-1')}
        >
          {credentialsQuery.isLoading ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading connected accounts...
            </div>
          ) : credentialsQuery.error ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              Unable to load connected accounts.
            </div>
          ) : credentials.length === 0 ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              No {providerName} accounts connected.
            </div>
          ) : isLoadingAccounts ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading broker accounts...
            </div>
          ) : accountOptions.length === 0 ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {hasAccountRequestError
                ? 'Unable to load broker accounts.'
                : 'No broker accounts found.'}
            </div>
          ) : (
            accountOptions.map((option) => {
              const isSelected = option.key === selectedKey
              return (
                <DropdownMenuItem
                  key={option.key}
                  className={cn(widgetHeaderMenuItemClassName, 'items-center justify-between')}
                  onSelect={() => {
                    if (isSelected) return
                    onAccountSelect?.({
                      credentialId: option.credentialId,
                      environment: option.environment,
                      accountId: option.accountId,
                    })
                  }}
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate text-foreground'>
                      {getAccountName(option.account)}
                    </span>
                    <span className='truncate text-muted-foreground text-[11px]'>
                      {option.credential.name} - {option.environmentLabel}
                    </span>
                  </span>
                  {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
                </DropdownMenuItem>
              )
            })
          )}

          {oauthProvider ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={cn(widgetHeaderMenuItemClassName, 'items-center text-foreground')}
                onSelect={() => setShowOAuthModal(true)}
              >
                <Plus className='h-3.5 w-3.5 text-muted-foreground' />
                <span>
                  {credentials.length === 0
                    ? `Connect ${providerName} account`
                    : `Connect another ${providerName} account`}
                </span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      {oauthProvider ? (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={handleOAuthClose}
          provider={oauthProvider}
          toolName={toolName}
          requiredScopes={providerDefinition?.oauth?.scopes}
          serviceId={providerDefinition?.oauth?.serviceId}
        />
      ) : null}
    </>
  )
}
