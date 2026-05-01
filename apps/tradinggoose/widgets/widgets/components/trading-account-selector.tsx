'use client'

import { useState } from 'react'
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
import { useTradingAccounts } from '@/hooks/queries/trading-portfolio'
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

export type TradingAccountSelection = {
  accountId: string
}

type TradingAccountSelectorProps = {
  workspaceId?: string | null
  providerId?: string | null
  accountId?: string | null
  disabled?: boolean
  placeholder?: string
  tooltipText?: string
  toolName?: string
  onAccountSelect?: (selection: TradingAccountSelection) => void
}

const getAccountName = (account: UnifiedTradingAccount) => account.name ?? account.id

const getAccountDescription = (account: UnifiedTradingAccount) =>
  [account.type, account.status, account.baseCurrency].filter(Boolean).join(' - ')

export function TradingAccountSelector({
  workspaceId,
  providerId,
  accountId,
  disabled = false,
  placeholder = 'Select account',
  tooltipText = 'Select trading account',
  toolName = 'Trading',
  onAccountSelect,
}: TradingAccountSelectorProps) {
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const trimmedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const providerName = providerDefinition?.name ?? 'broker'
  const oauthProvider = providerDefinition?.oauth?.provider
  const oauthServiceId =
    providerDefinition?.oauth?.serviceId ?? providerDefinition?.oauth?.provider
  const isEnabled = Boolean(trimmedWorkspaceId && trimmedProviderId) && !disabled
  const credentialsQuery = useOAuthCredentials(oauthServiceId, isEnabled)
  const hasConnection = (credentialsQuery.data ?? []).length > 0
  const accountsQuery = useTradingAccounts({
    workspaceId: trimmedWorkspaceId || undefined,
    provider: trimmedProviderId || undefined,
    enabled: isEnabled && hasConnection,
  })
  const accounts = accountsQuery.data ?? []
  const selectedOption = accounts.find((account) => account.id === accountId) ?? null
  const buttonLabel = selectedOption ? getAccountName(selectedOption) : accountId || placeholder
  const isLoadingAccounts =
    credentialsQuery.isLoading || accountsQuery.isLoading || accountsQuery.isFetching
  const ProviderIcon = resolveTradingProviderIcon(trimmedProviderId)

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    void credentialsQuery.refetch()
    void accountsQuery.refetch()
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
                  disabled={!trimmedProviderId || disabled}
                  className={widgetHeaderControlClassName('group flex justify-between gap-2')}
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
                        'min-w-0 truncate text-left',
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
          className={cn(widgetHeaderMenuContentClassName, 'w-[300px] p-1')}
        >
          {credentialsQuery.isLoading ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading provider connection...
            </div>
          ) : credentialsQuery.error ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              Unable to load provider connection.
            </div>
          ) : !hasConnection ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              No {providerName} account connected.
            </div>
          ) : isLoadingAccounts ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading broker accounts...
            </div>
          ) : accounts.length === 0 ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {accountsQuery.error ? 'Unable to load broker accounts.' : 'No broker accounts found.'}
            </div>
          ) : (
            accounts.map((account) => {
              const isSelected = account.id === accountId
              return (
                <DropdownMenuItem
                  key={account.id}
                  className={cn(widgetHeaderMenuItemClassName, 'items-center justify-between')}
                  onSelect={() => {
                    if (isSelected) return
                    onAccountSelect?.({ accountId: account.id })
                  }}
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate text-foreground'>{getAccountName(account)}</span>
                    <span className='truncate text-muted-foreground text-[11px]'>
                      {getAccountDescription(account)}
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
                  {hasConnection
                    ? `Reconnect ${providerName} account`
                    : `Connect ${providerName} account`}
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
