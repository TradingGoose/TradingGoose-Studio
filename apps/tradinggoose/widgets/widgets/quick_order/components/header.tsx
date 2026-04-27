'use client'

import { useMemo, useState } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { useTradingAccounts } from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitQuickOrderParamsChange } from '@/widgets/utils/quick-order-params'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import {
  getQuickOrderDefaultEnvironment,
  getQuickOrderEnvironmentOptions,
  getQuickOrderProviderAvailabilityIds,
  getQuickOrderProviderOptions,
  resolveQuickOrderCredentialProvider,
  resolveQuickOrderProviderId,
} from '@/widgets/widgets/quick_order/components/shared'
import type { QuickOrderSide, QuickOrderWidgetParams } from '@/widgets/widgets/quick_order/types'

type HeaderControlProps = {
  panelId?: string
  widgetKey: string
  params: QuickOrderWidgetParams | null
}

function QuickOrderProviderSettingsButton({
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
          if (nextOpen && providerId) void onRefreshCredentials()
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type='button'
                className={widgetHeaderIconButtonClassName()}
                disabled={!providerId}
                aria-label='Edit quick order provider settings'
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
              Choose a {providerName} connection and environment for manual orders.
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
                          emitQuickOrderParamsChange({
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
                        emitQuickOrderParamsChange({
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
          toolName='Quick Order'
          requiredScopes={providerDefinition?.oauth?.scopes}
          serviceId={providerDefinition?.oauth?.serviceId}
        />
      ) : null}
    </>
  )
}

export function QuickOrderHeaderControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getQuickOrderProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getQuickOrderProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveQuickOrderProviderId(params?.provider, providerAvailabilityQuery.data)
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider = Boolean(params?.provider) && params?.provider === providerId
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolveQuickOrderCredentialProvider(providerId)
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
    () =>
      hasSelectedProvider
        ? getQuickOrderEnvironmentOptions(providerId).map((environment) => ({
            id: environment,
            label: environment === 'paper' ? 'Paper' : 'Live',
          }))
        : [],
    [hasSelectedProvider, providerId]
  )
  const environment =
    hasSelectedProvider &&
    params?.environment &&
    environmentOptions.some((option) => option.id === params.environment)
      ? params.environment
      : hasSelectedProvider
        ? getQuickOrderDefaultEnvironment(providerId)
        : undefined
  const accountsQuery = useTradingAccounts({
    provider: hasSelectedProvider && areProviderOptionsReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: hasSelectedProvider && areProviderOptionsReady ? environment : undefined,
  })

  if (!areProviderOptionsReady) {
    return <div className={widgetHeaderButtonGroupClassName()} />
  }

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <QuickOrderProviderSettingsButton
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

          emitQuickOrderParamsChange({
            params: {
              provider: nextProvider,
              environment: getQuickOrderDefaultEnvironment(nextProvider) ?? null,
              credentialId: null,
              accountId: null,
            },
            panelId,
            widgetKey,
          })
        }}
      />

      <div className='w-[190px]'>
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
            emitQuickOrderParamsChange({
              params: { accountId },
              panelId,
              widgetKey,
            })
          }}
        />
      </div>
    </div>
  )
}

function QuickOrderSideTabs({ panelId, widgetKey, params }: HeaderControlProps) {
  const side = params?.side === 'sell' ? 'sell' : 'buy'
  const sides: Array<{ id: QuickOrderSide; label: string }> = [
    { id: 'buy', label: 'BUY' },
    { id: 'sell', label: 'SELL' },
  ]

  return (
    <div className='flex h-8 overflow-hidden rounded-md border border-border/70 bg-card/60 p-0.5'>
      {sides.map((option) => {
        const isSelected = option.id === side

        return (
          <button
            key={option.id}
            type='button'
            className={`min-w-14 rounded-sm border px-3 text-center font-semibold text-[11px] transition-colors ${
              isSelected
                ? option.id === 'buy'
                  ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-300'
                  : 'border-rose-400/60 bg-rose-500/15 text-rose-300'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              if (option.id === side) return
              emitQuickOrderParamsChange({
                params: { side: option.id },
                panelId,
                widgetKey,
              })
            }}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export const renderQuickOrderHeader: DashboardWidgetDefinition['renderHeader'] = ({
  panelId,
  widget,
}) => ({
  left: (
    <QuickOrderHeaderControls
      panelId={panelId}
      widgetKey={widget?.key ?? 'quick_order'}
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
  center: (
    <QuickOrderSideTabs
      panelId={panelId}
      widgetKey={widget?.key ?? 'quick_order'}
      params={(widget?.params as QuickOrderWidgetParams | null | undefined) ?? null}
    />
  ),
})
