'use client'

import { useState } from 'react'
import { Check, ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { OAuthRequiredModal } from '@/components/oauth/oauth-required-modal'
import {
  type ProviderSelectorVariant,
  providerSelectorMenuContentClassName,
  providerSelectorMenuItemClassName,
  providerSelectorTriggerClassName,
} from '@/components/provider-selector'
import { resolveTradingProviderIcon } from '@/components/trading-selector/provider-selector'
import { getTradingServiceName, useTradingServices } from '@/components/trading-selector/services'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePortfolioIdentities } from '@/hooks/queries/trading-portfolio'
import { formatTemplate } from '@/i18n/utils'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
import {
  arePortfolioIdentitiesEqual,
  getPortfolioIdentityKey,
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import { getTradingProviderDefinition } from '@/providers/trading/providers'

export type TradingAccountSelection = {
  serviceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
}

type TradingAccountSelectorProps = {
  providerId?: string | null
  serviceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
  disabled?: boolean
  placeholder?: string
  tooltipText?: string
  toolName?: string
  onAccountSelect?: (selection: TradingAccountSelection) => void
  variant?: ProviderSelectorVariant
}

const getAccountName = (portfolioIdentity: PortfolioIdentity) =>
  portfolioIdentity.accountName ?? portfolioIdentity.accountId

const getAccountDescriptionPart = (value?: string | null) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed && trimmed !== 'unknown' ? trimmed : null
}

const getAccountDescription = (providerId: string, portfolioIdentity: PortfolioIdentity) =>
  [
    getTradingServiceName(providerId, portfolioIdentity.serviceId),
    portfolioIdentity.accountType,
    portfolioIdentity.accountStatus,
    portfolioIdentity.baseCurrency,
  ]
    .map(getAccountDescriptionPart)
    .filter(Boolean)
    .join(' - ')

export function TradingAccountSelector({
  providerId,
  serviceId,
  portfolioIdentity,
  disabled = false,
  placeholder,
  tooltipText,
  toolName = 'Trading',
  onAccountSelect,
  variant = 'widget',
}: TradingAccountSelectorProps) {
  const copy = useWorkspaceWidgetsMessages().providerControls.accountSelector
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [oauthModalServiceId, setOAuthModalServiceId] = useState<string | null>(null)
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const providerDefinition = trimmedProviderId
    ? getTradingProviderDefinition(trimmedProviderId)
    : undefined
  const providerName = providerDefinition?.name ?? copy.fallbackProviderName
  const resolvedPlaceholder = placeholder ?? copy.placeholder
  const resolvedTooltipText = tooltipText ?? copy.tooltip
  const oauthProvider = providerDefinition?.oauth?.provider
  const isEnabled = Boolean(trimmedProviderId) && !disabled
  const selectedPortfolioIdentity = toPortfolioValueObject(portfolioIdentity)
  const requestedServiceId = serviceId ?? selectedPortfolioIdentity?.serviceId
  const services = useTradingServices({
    providerId: trimmedProviderId,
    serviceId: requestedServiceId,
    enabled: isEnabled,
  })
  const activeServiceId = services.activeServiceId
  const hasConnection = Boolean(activeServiceId)
  const accountsQuery = usePortfolioIdentities({
    provider: trimmedProviderId || undefined,
    serviceId: activeServiceId,
    enabled: isEnabled && hasConnection,
  })
  const portfolioIdentities = accountsQuery.data ?? []
  const selectedOption =
    portfolioIdentities.find((account) =>
      arePortfolioIdentitiesEqual(account, selectedPortfolioIdentity)
    ) ?? null
  const isLoadingAccounts =
    services.isLoading || accountsQuery.isLoading || accountsQuery.isFetching
  const hasUnresolvedSelectedAccount = Boolean(selectedPortfolioIdentity && !selectedOption)
  const buttonLabel = selectedOption
    ? getAccountName(selectedOption)
    : hasUnresolvedSelectedAccount && isLoadingAccounts
      ? copy.loadingAccount
      : resolvedPlaceholder
  const ProviderIcon = resolveTradingProviderIcon(trimmedProviderId)

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    services.refetch()
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
            <span className={cn('inline-flex', variant === 'form' && 'w-full')}>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  disabled={!trimmedProviderId || disabled}
                  className={providerSelectorTriggerClassName(variant, 'gap-2')}
                  aria-haspopup='listbox'
                  aria-label={copy.ariaLabel}
                >
                  <div className='flex min-w-0 items-center gap-1.5'>
                    {ProviderIcon ? (
                      <ProviderIcon
                        className='h-4 w-4 shrink-0 text-muted-foreground'
                        aria-hidden='true'
                      />
                    ) : null}
                    <span
                      className={cn(
                        'min-w-0 truncate text-left',
                        selectedOption
                          ? cn('text-foreground', variant === 'widget' && 'font-medium')
                          : 'text-muted-foreground'
                      )}
                    >
                      {buttonLabel}
                    </span>
                  </div>
                  <ChevronDown
                    className='h-4 w-4 shrink-0 text-muted-foreground opacity-50 transition-transform group-data-[state=open]:rotate-180'
                    aria-hidden='true'
                  />
                </button>
              </DropdownMenuTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side='top'>{resolvedTooltipText}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={providerSelectorMenuContentClassName(
            variant,
            variant === 'widget' ? 'w-[300px]' : undefined
          )}
        >
          {services.isLoading ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              {copy.loadingProviderConnection}
            </div>
          ) : services.error ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {copy.unableToLoadProviderConnection}
            </div>
          ) : services.serviceIds.length > 1 &&
            services.connectedServiceIds.length > 0 &&
            !activeServiceId ? (
            <>
              <div className='px-3 py-2 text-muted-foreground text-xs'>
                {formatTemplate(copy.selectConnection, { providerName })}
              </div>
              {services.connectedServiceIds.map((serviceId) => (
                <DropdownMenuItem
                  key={serviceId}
                  className={providerSelectorMenuItemClassName(
                    variant,
                    'items-center justify-between'
                  )}
                  onSelect={() => {
                    onAccountSelect?.({ portfolioIdentity: null, serviceId: serviceId })
                  }}
                >
                  <span className='truncate text-foreground'>
                    {getTradingServiceName(trimmedProviderId, serviceId)}
                  </span>
                </DropdownMenuItem>
              ))}
            </>
          ) : !hasConnection ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {formatTemplate(copy.noAccountConnected, { providerName })}
            </div>
          ) : isLoadingAccounts ? (
            <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
              <RefreshCw className='h-3.5 w-3.5 animate-spin' />
              {copy.loadingBrokerAccounts}
            </div>
          ) : portfolioIdentities.length === 0 ? (
            <div className='px-3 py-2 text-muted-foreground text-xs'>
              {accountsQuery.error
                ? copy.unableToLoadBrokerAccounts
                : copy.noBrokerAccountsFound}
            </div>
          ) : (
            portfolioIdentities.map((account) => {
              const isSelected = arePortfolioIdentitiesEqual(account, selectedPortfolioIdentity)
              const accountDescription = getAccountDescription(trimmedProviderId, account)
              return (
                <DropdownMenuItem
                  key={getPortfolioIdentityKey(account)}
                  className={providerSelectorMenuItemClassName(
                    variant,
                    'items-center justify-between'
                  )}
                  onSelect={() => {
                    if (isSelected) return
                    onAccountSelect?.({
                      serviceId: activeServiceId,
                      portfolioIdentity: account,
                    })
                  }}
                >
                  <span className={cn('min-w-0', variant === 'widget' && 'flex flex-col')}>
                    <span className='truncate text-foreground'>{getAccountName(account)}</span>
                    {variant === 'widget' && accountDescription ? (
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

          {oauthProvider && services.serviceIds.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              {services.serviceIds.map((serviceId) => (
                <DropdownMenuItem
                  key={serviceId}
                  className={providerSelectorMenuItemClassName(
                    variant,
                    'items-center text-foreground'
                  )}
                  onSelect={() => openOAuthModal(serviceId)}
                >
                  <Plus className='h-3.5 w-3.5 text-muted-foreground' />
                  <span>
                    {formatTemplate(
                      services.connectedServiceIds.includes(serviceId)
                        ? copy.reconnectAccount
                        : copy.connectAccount,
                      {
                        providerName:
                          getTradingServiceName(trimmedProviderId, serviceId) ||
                          copy.fallbackProviderName,
                      }
                    )}
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
          serviceIds={services.serviceIds}
        />
      ) : null}
    </>
  )
}
