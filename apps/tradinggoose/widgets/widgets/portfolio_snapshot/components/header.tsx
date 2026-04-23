'use client'

import { useMemo, useState } from 'react'
import { Check, KeyRound, RefreshCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { useTradingAccounts } from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitPortfolioSnapshotParamsChange } from '@/widgets/utils/portfolio-snapshot-params'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import {
  getPortfolioSnapshotDefaultEnvironment,
  getPortfolioSnapshotEnvironmentOptions,
  getPortfolioSnapshotProviderAvailabilityIds,
  getPortfolioSnapshotProviderOptions,
  resolvePortfolioSnapshotCredentialProvider,
  resolvePortfolioSnapshotProviderId,
} from '@/widgets/widgets/portfolio_snapshot/components/shared'
import type { PortfolioSnapshotWidgetParams } from '@/widgets/widgets/portfolio_snapshot/types'

type HeaderControlProps = {
  panelId?: string
  widgetKey: string
  params: PortfolioSnapshotWidgetParams | null
}

function PortfolioSnapshotProviderSettingsButton({
  panelId,
  widgetKey,
  providerId,
  environment,
  environmentOptions,
  selectedCredentialId,
  credentials,
  isCredentialsLoading,
  onRefreshCredentials,
}: {
  panelId?: string
  widgetKey: string
  providerId?: string
  environment?: string
  environmentOptions: Array<{ id: string; label: string }>
  selectedCredentialId?: string
  credentials: Array<{ id: string; name: string }>
  isCredentialsLoading: boolean
  onRefreshCredentials: () => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const providerDefinition = providerId ? getTradingProviderDefinition(providerId) : undefined
  const providerName = providerDefinition?.name ?? 'broker'
  const oauthProvider = providerDefinition?.oauth?.provider

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen)
          if (nextOpen && providerId) {
            void onRefreshCredentials()
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={!providerId}
                aria-label='Edit portfolio provider settings'
              >
                <KeyRound className='h-3.5 w-3.5' />
                <span className='sr-only'>Provider settings</span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side='top'>Provider settings</TooltipContent>
        </Tooltip>
        <PopoverContent className='w-72 space-y-3 p-4' align='start'>
          <div className='space-y-1'>
            <p className='font-medium text-sm'>Provider settings</p>
            <p className='text-muted-foreground text-xs'>
              Choose a {providerName} connection and environment for this widget.
            </p>
          </div>

          {providerId ? (
            <div className='space-y-2'>
              <div className='font-medium text-xs'>Connection</div>
              {isCredentialsLoading ? (
                <div className='text-muted-foreground text-xs'>Loading connections...</div>
              ) : credentials.length === 0 ? (
                <div className='space-y-2'>
                  <div className='text-muted-foreground text-xs'>
                    No {providerName} connections are available yet.
                  </div>
                  {oauthProvider ? (
                    <button
                      type='button'
                      className='rounded-sm border border-border/70 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-card hover:text-foreground'
                      onClick={() => setShowOAuthModal(true)}
                    >
                      Connect {providerName}
                    </button>
                  ) : null}
                </div>
              ) : (
                <div className='space-y-1'>
                  {credentials.map((credential) => {
                    const isSelected = credential.id === selectedCredentialId

                    return (
                      <button
                        key={credential.id}
                        type='button'
                        className={`flex w-full items-center justify-between rounded-sm border px-2 py-1.5 text-left text-xs transition-colors ${
                          isSelected
                            ? 'border-foreground/40 bg-foreground/10 text-foreground'
                            : 'border-border/70 text-muted-foreground hover:bg-card hover:text-foreground'
                        }`}
                        onClick={() => {
                          emitPortfolioSnapshotParamsChange({
                            params: {
                              credentialId: credential.id,
                              accountId: null,
                            },
                            panelId,
                            widgetKey,
                          })
                          setOpen(false)
                        }}
                      >
                        <span className='truncate'>{credential.name}</span>
                        {isSelected ? <Check className='h-3.5 w-3.5 shrink-0' /> : null}
                      </button>
                    )
                  })}
                  {oauthProvider ? (
                    <button
                      type='button'
                      className='rounded-sm border border-border/70 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-card hover:text-foreground'
                      onClick={() => setShowOAuthModal(true)}
                    >
                      Connect another {providerName}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <div className='text-muted-foreground text-xs'>Select a trading provider first.</div>
          )}

          {environmentOptions.length > 0 ? (
            <div className='space-y-2'>
              <div className='font-medium text-xs'>Environment</div>
              <div className='flex flex-wrap gap-1'>
                {environmentOptions.map((option) => {
                  const isSelected = option.id === environment

                  return (
                    <button
                      key={option.id}
                      type='button'
                      className={`rounded-sm border px-2 py-1 text-xs transition-colors ${
                        isSelected
                          ? 'border-foreground/40 bg-foreground/10 text-foreground'
                          : 'border-border/70 text-muted-foreground hover:bg-card'
                      }`}
                      onClick={() => {
                        emitPortfolioSnapshotParamsChange({
                          params: {
                            environment: option.id,
                            accountId: null,
                          },
                          panelId,
                          widgetKey,
                        })
                        setOpen(false)
                      }}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {oauthProvider ? (
        <OAuthRequiredModal
          isOpen={showOAuthModal}
          onClose={() => {
            setShowOAuthModal(false)
            void onRefreshCredentials()
          }}
          provider={oauthProvider}
          toolName='Portfolio Snapshot'
          requiredScopes={providerDefinition?.oauth?.scopes}
          serviceId={providerDefinition?.oauth?.serviceId}
        />
      ) : null}
    </>
  )
}

export function PortfolioSnapshotHeaderControls({
  panelId,
  widgetKey,
  params,
}: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getPortfolioSnapshotProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getPortfolioSnapshotProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolvePortfolioSnapshotProviderId(params, providerOptions)
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider = Boolean(params?.provider) && params?.provider === providerId
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolvePortfolioSnapshotCredentialProvider(providerId)
      : undefined
  const credentialsQuery = useOAuthCredentials(
    credentialProviderId,
    hasSelectedProvider && areProviderOptionsReady && Boolean(credentialProviderId)
  )
  const { data: credentials = [], refetch: refetchCredentials } = credentialsQuery
  const selectedCredential =
    params?.credentialId &&
    hasSelectedProvider &&
    !credentialsQuery.isLoading &&
    !credentialsQuery.error
      ? (credentials.find((credential) => credential.id === params.credentialId) ?? null)
      : null
  const missingPersistedCredential =
    hasSelectedProvider &&
    Boolean(params?.credentialId) &&
    !credentialsQuery.isLoading &&
    !credentialsQuery.error &&
    !selectedCredential
  const activeCredentialId =
    hasValidPersistedProvider && !missingPersistedCredential ? params?.credentialId : undefined
  const environmentOptions = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const environment =
    hasSelectedProvider &&
    params?.environment &&
    environmentOptions.some((option) => option.id === params.environment)
      ? params.environment
      : hasSelectedProvider
        ? getPortfolioSnapshotDefaultEnvironment(providerId)
        : undefined

  if (!areProviderOptionsReady) {
    return <div className={widgetHeaderButtonGroupClassName()} />
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <PortfolioSnapshotProviderSettingsButton
        panelId={panelId}
        widgetKey={widgetKey}
        providerId={providerId || undefined}
        environment={environment}
        environmentOptions={environmentOptions}
        selectedCredentialId={activeCredentialId}
        credentials={credentials}
        isCredentialsLoading={credentialsQuery.isLoading}
        onRefreshCredentials={refetchCredentials}
      />

      <TradingProviderSelector
        value={providerId || ''}
        options={providerOptions}
        onChange={(nextProvider) => {
          if (!nextProvider || nextProvider === providerId) return

          const nextEnvironment = getPortfolioSnapshotDefaultEnvironment(nextProvider)
          emitPortfolioSnapshotParamsChange({
            params: {
              provider: nextProvider,
              environment: nextEnvironment ?? null,
              credentialId: null,
              accountId: null,
              selectedWindow: null,
            },
            panelId,
            widgetKey,
          })
        }}
      />

      {providerId ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              onClick={() => {
                emitPortfolioSnapshotParamsChange({
                  params: {
                    runtime: {
                      refreshAt: Date.now(),
                    },
                  },
                  panelId,
                  widgetKey,
                })
              }}
              aria-label='Refresh portfolio snapshot'
            >
              <RefreshCw className='h-3.5 w-3.5' />
              <span className='sr-only'>Refresh portfolio snapshot</span>
            </button>
          </TooltipTrigger>
          <TooltipContent side='top'>Refresh portfolio snapshot</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}

function PortfolioSnapshotHeaderCenterControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getPortfolioSnapshotProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getPortfolioSnapshotProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolvePortfolioSnapshotProviderId(params, providerOptions)
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider = Boolean(params?.provider) && params?.provider === providerId
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolvePortfolioSnapshotCredentialProvider(providerId)
      : undefined
  const credentialsQuery = useOAuthCredentials(
    credentialProviderId,
    hasSelectedProvider && areProviderOptionsReady && Boolean(credentialProviderId)
  )
  const credentials = credentialsQuery.data ?? []
  const selectedCredential =
    params?.credentialId &&
    hasSelectedProvider &&
    !credentialsQuery.isLoading &&
    !credentialsQuery.error
      ? (credentials.find((credential) => credential.id === params.credentialId) ?? null)
      : null
  const missingPersistedCredential =
    hasSelectedProvider &&
    Boolean(params?.credentialId) &&
    !credentialsQuery.isLoading &&
    !credentialsQuery.error &&
    !selectedCredential
  const activeCredentialId =
    hasValidPersistedProvider && !missingPersistedCredential ? params?.credentialId : undefined
  const environmentOptions = useMemo(
    () => (hasSelectedProvider ? getPortfolioSnapshotEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const environment =
    hasSelectedProvider &&
    params?.environment &&
    environmentOptions.some((option) => option.id === params.environment)
      ? params.environment
      : hasSelectedProvider
        ? getPortfolioSnapshotDefaultEnvironment(providerId)
        : undefined
  const accountsQuery = useTradingAccounts({
    provider: hasSelectedProvider && areProviderOptionsReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: hasSelectedProvider && areProviderOptionsReady ? environment : undefined,
  })

  if (!areProviderOptionsReady) {
    return null
  }

  return (
    <div className='min-w-[240px]'>
      <TradingAccountSelector
        accountId={params?.accountId}
        accounts={accountsQuery.data ?? []}
        isAccountsLoading={accountsQuery.isLoading}
        accountsError={accountsQuery.error}
        disabled={!hasSelectedProvider || !activeCredentialId}
        placeholder='Select account'
        tooltipText={
          !hasSelectedProvider
            ? 'Select trading provider first'
            : !activeCredentialId
              ? 'Select a provider connection in settings first'
              : 'Select trading account'
        }
        onAccountSelect={(accountId) => {
          emitPortfolioSnapshotParamsChange({
            params: { accountId },
            panelId,
            widgetKey,
          })
        }}
      />
    </div>
  )
}

export const renderPortfolioSnapshotHeader: DashboardWidgetDefinition['renderHeader'] = ({
  panelId,
  widget,
}) => ({
  left: (
    <PortfolioSnapshotHeaderControls
      panelId={panelId}
      widgetKey={widget?.key ?? 'portfolio_snapshot'}
      params={(widget?.params as PortfolioSnapshotWidgetParams | null | undefined) ?? null}
    />
  ),
  center: (
    <PortfolioSnapshotHeaderCenterControls
      panelId={panelId}
      widgetKey={widget?.key ?? 'portfolio_snapshot'}
      params={(widget?.params as PortfolioSnapshotWidgetParams | null | undefined) ?? null}
    />
  ),
})
