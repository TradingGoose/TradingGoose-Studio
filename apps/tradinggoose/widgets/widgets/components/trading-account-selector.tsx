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
import {
  arePortfolioIdentitiesEqual,
  getPortfolioIdentityKey,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import { cn } from '@/lib/utils'
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import {
  getTradingCredentialServiceName,
  useTradingCredentialServices,
} from '@/widgets/widgets/components/trading-credential-services'
import { resolveTradingProviderIcon } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'

export type TradingAccountSelection = {
  credentialServiceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
}

type TradingAccountSelectorProps = {
  workspaceId?: string | null
  providerId?: string | null
  credentialServiceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
  disabled?: boolean
  placeholder?: string
  tooltipText?: string
  toolName?: string
  onAccountSelect?: (selection: TradingAccountSelection) => void
}

const getAccountName = (portfolioIdentity: PortfolioIdentity) =>
  portfolioIdentity.accountName ?? portfolioIdentity.accountId

const getAccountDescriptionPart = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed && trimmed !== 'unknown' ? trimmed : null
}

const getAccountDescription = (portfolioIdentity: PortfolioIdentity) =>
  [
    portfolioIdentity.accountType,
    portfolioIdentity.accountStatus,
    portfolioIdentity.baseCurrency,
  ]
    .map(getAccountDescriptionPart)
    .filter(Boolean)
    .join(' - ')

export function TradingAccountSelector({
  workspaceId,
  providerId,
  credentialServiceId,
  portfolioIdentity,
  disabled = false,
  placeholder = 'Select account',
  tooltipText = 'Select trading account',
  toolName = 'Trading',
  onAccountSelect,
}: TradingAccountSelectorProps) {
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [oauthModalServiceId, setOAuthModalServiceId] = useState<string | null>(null)
  const trimmedWorkspaceId = typeof workspaceId === 'string' ? workspaceId.trim() : ''
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const providerName = providerDefinition?.name ?? 'broker'
  const oauthProvider = providerDefinition?.oauth?.provider
  const isEnabled = Boolean(trimmedWorkspaceId && trimmedProviderId) && !disabled
  const credentialServices = useTradingCredentialServices({
    providerId: trimmedProviderId,
    credentialServiceId,
    enabled: isEnabled,
  })
  const activeServiceId = credentialServices.activeServiceId
  const hasConnection =
    Boolean(activeServiceId) && credentialServices.connectedServiceIds.includes(activeServiceId!)
  const accountsQuery = usePortfolioIdentities({
    workspaceId: trimmedWorkspaceId || undefined,
    provider: trimmedProviderId || undefined,
    credentialServiceId: activeServiceId,
    enabled: isEnabled && hasConnection,
  })
  const portfolioIdentities = accountsQuery.data ?? []
  const selectedPortfolioIdentity = toPortfolioValueObject(portfolioIdentity)
  const selectedOption =
    portfolioIdentities.find((account) =>
      arePortfolioIdentitiesEqual(account, selectedPortfolioIdentity)
    ) ?? null
  const isLoadingAccounts =
    credentialServices.isLoading || accountsQuery.isLoading || accountsQuery.isFetching
  const hasUnresolvedSelectedAccount = Boolean(selectedPortfolioIdentity && !selectedOption)
  const buttonLabel = selectedOption
    ? getAccountName(selectedOption)
    : hasUnresolvedSelectedAccount && isLoadingAccounts
      ? 'Loading account...'
      : placeholder
  const ProviderIcon = resolveTradingProviderIcon(trimmedProviderId)

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    credentialServices.refetch()
    void accountsQuery.refetch()
  }

  const openOAuthModal = (serviceId: string) => {
    setOAuthModalServiceId(serviceId)
    setShowOAuthModal(true)
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
          {credentialServices.isLoading ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading provider connection...
            </div>
          ) : credentialServices.error ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              Unable to load provider connection.
            </div>
          ) : credentialServices.serviceIds.length > 1 && !activeServiceId ? (
            <>
              <div className='px-3 py-2 text-muted-foreground text-xs'>
                Select a {providerName} connection.
              </div>
              {credentialServices.connectedServiceIds.map((serviceId) => (
                <DropdownMenuItem
                  key={serviceId}
                  className={cn(widgetHeaderMenuItemClassName, 'items-center justify-between')}
                  onSelect={() => {
                    onAccountSelect?.({ portfolioIdentity: null, credentialServiceId: serviceId })
                  }}
                >
                  <span className='truncate text-foreground'>
                    {getTradingCredentialServiceName(trimmedProviderId, serviceId)}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : !hasConnection ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              No {providerName} account connected.
            </div>
          ) : isLoadingAccounts ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              Loading broker accounts...
            </div>
          ) : portfolioIdentities.length === 0 ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {accountsQuery.error
                ? 'Unable to load broker accounts.'
                : 'No broker accounts found.'}
            </div>
          ) : (
            portfolioIdentities.map((account) => {
              const isSelected = arePortfolioIdentitiesEqual(account, selectedPortfolioIdentity)
              const accountDescription = getAccountDescription(account)
              return (
                <DropdownMenuItem
                  key={getPortfolioIdentityKey(account)}
                  className={cn(widgetHeaderMenuItemClassName, 'items-center justify-between')}
                  onSelect={() => {
                    if (isSelected) return
                    onAccountSelect?.({
                      credentialServiceId: activeServiceId,
                      portfolioIdentity: account,
                    })
                  }}
                >
                  <span className='flex min-w-0 flex-col'>
                    <span className='truncate text-foreground'>{getAccountName(account)}</span>
                    {accountDescription ? (
                      <span className='truncate text-[11px] text-muted-foreground'>
                        {accountDescription}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? <Check className='h-3.5 w-3.5 text-primary' /> : null}
                </DropdownMenuItem>
              )
            })
          )}

          {oauthProvider && credentialServices.serviceIds.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {credentialServices.serviceIds.map((serviceId) => (
                <DropdownMenuItem
                  key={serviceId}
                  className={cn(widgetHeaderMenuItemClassName, 'items-center text-foreground')}
                  onSelect={() => openOAuthModal(serviceId)}
                >
                  <Plus className='h-3.5 w-3.5 text-muted-foreground' />
                  <span>
                    {credentialServices.connectedServiceIds.includes(serviceId)
                      ? `Reconnect ${getTradingCredentialServiceName(trimmedProviderId, serviceId)} account`
                      : `Connect ${getTradingCredentialServiceName(trimmedProviderId, serviceId)} account`}
                  </span>
                </DropdownMenuItem>
              ))}
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
          serviceId={oauthModalServiceId ?? activeServiceId}
          serviceIds={credentialServices.serviceIds}
        />
      ) : null}
    </>
  )
}
