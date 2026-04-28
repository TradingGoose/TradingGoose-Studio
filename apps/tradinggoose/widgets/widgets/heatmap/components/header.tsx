'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, KeyRound, RefreshCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOAuthCredentials } from '@/hooks/queries/oauth-credentials'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import { useTradingAccounts } from '@/hooks/queries/trading-portfolio'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { emitHeatmapParamsChange } from '@/widgets/utils/heatmap-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { MarketProviderSettingsButton } from '@/widgets/widgets/components/market-provider-settings-button'
import { TradingAccountSelector } from '@/widgets/widgets/components/trading-account-selector'
import { TradingProviderSelector } from '@/widgets/widgets/components/trading-provider-selector'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { OAuthRequiredModal } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/credential-selector/components/oauth-required-modal'
import {
  getHeatmapMarketProviderOptions,
  getHeatmapTradingEnvironmentOptions,
  getHeatmapTradingProviderAvailabilityIds,
  getHeatmapTradingProviderOptions,
  HEATMAP_SOURCE_MODES,
  resolveHeatmapCredentialProvider,
  resolveHeatmapEnvironment,
  resolveHeatmapMarketProviderId,
  resolveHeatmapSourceMode,
  resolveHeatmapTradingProviderId,
  shouldPersistHeatmapMarketProviderDefault,
} from '@/widgets/widgets/heatmap/components/shared'
import type { HeatmapWidgetParams } from '@/widgets/widgets/heatmap/types'

type HeaderControlProps = {
  workspaceId?: string
  panelId?: string
  widgetKey: string
  params: HeatmapWidgetParams | null
}

function HeatmapTradingProviderSettingsButton({
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
                aria-label='Edit heatmap trading provider settings'
              >
                <KeyRound className='h-3.5 w-3.5' />
                <span className='sr-only'>Trading provider settings</span>
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side='top'>Trading provider settings</TooltipContent>
        </Tooltip>
        <PopoverContent className='w-72 space-y-3 p-4' align='end'>
          <div className='space-y-1'>
            <p className='font-medium text-sm'>Trading provider</p>
            <p className='text-muted-foreground text-xs'>
              Choose a {providerName} connection and environment for portfolio holdings.
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
                          emitHeatmapParamsChange({
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
                        emitHeatmapParamsChange({
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
          toolName='Heatmap'
          requiredScopes={providerDefinition?.oauth?.scopes}
          serviceId={providerDefinition?.oauth?.serviceId}
        />
      ) : null}
    </>
  )
}

function HeatmapMarketControls({ workspaceId, panelId, widgetKey, params }: HeaderControlProps) {
  const marketProviderOptions = useMemo(() => getHeatmapMarketProviderOptions(), [])
  const marketProviderId = resolveHeatmapMarketProviderId(params, marketProviderOptions)

  useEffect(() => {
    if (!shouldPersistHeatmapMarketProviderDefault(params, marketProviderId)) return
    emitHeatmapParamsChange({
      params: { marketProvider: marketProviderId },
      panelId,
      widgetKey,
    })
  }, [marketProviderId, panelId, params, widgetKey])

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <MarketProviderSettingsButton
        providerId={marketProviderId}
        providerParams={params?.marketProviderParams}
        authParams={params?.marketAuth}
        workspaceId={workspaceId}
        onSave={({ providerParams, auth }) => {
          emitHeatmapParamsChange({
            params: {
              marketProviderParams: providerParams,
              marketAuth: auth,
              runtime: { refreshAt: Date.now() },
            },
            panelId,
            widgetKey,
          })
        }}
      />
      <MarketProviderSelector
        value={marketProviderId}
        options={marketProviderOptions}
        onChange={(nextProvider) => {
          if (!nextProvider || nextProvider === marketProviderId) return
          emitHeatmapParamsChange({
            params: {
              marketProvider: nextProvider,
              marketProviderParams: null,
              marketAuth: null,
              runtime: { refreshAt: Date.now() },
            },
            panelId,
            widgetKey,
          })
        }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            className={widgetHeaderIconButtonClassName()}
            onClick={() => {
              emitHeatmapParamsChange({
                params: { runtime: { refreshAt: Date.now() } },
                panelId,
                widgetKey,
              })
            }}
            aria-label='Refresh heatmap'
          >
            <RefreshCw className='h-3.5 w-3.5' />
            <span className='sr-only'>Refresh heatmap</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>Refresh heatmap</TooltipContent>
      </Tooltip>
    </div>
  )
}

function HeatmapSourceControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const sourceMode = resolveHeatmapSourceMode(params)

  return (
    <Tabs
      value={sourceMode}
      onValueChange={(nextMode) => {
        if (nextMode === sourceMode) return
        emitHeatmapParamsChange({
          params: { sourceMode: nextMode },
          panelId,
          widgetKey,
        })
      }}
    >
      <TabsList className={widgetHeaderButtonGroupClassName('h-8 rounded-sm p-0')}>
        {HEATMAP_SOURCE_MODES.map((mode) => (
          <TabsTrigger key={mode.id} value={mode.id} className='h-8 px-2 text-xs'>
            {mode.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

function HeatmapPortfolioControls({ panelId, widgetKey, params }: HeaderControlProps) {
  const providerAvailabilityQuery = useOAuthProviderAvailability(
    getHeatmapTradingProviderAvailabilityIds()
  )
  const providerOptions = useMemo(
    () => getHeatmapTradingProviderOptions(providerAvailabilityQuery.data),
    [providerAvailabilityQuery.data]
  )
  const providerId = resolveHeatmapTradingProviderId(params, providerOptions)
  const hasSelectedProvider = Boolean(providerId)
  const hasValidPersistedProvider =
    Boolean(params?.tradingProvider) && params?.tradingProvider === providerId
  const areProviderOptionsReady =
    !providerAvailabilityQuery.isLoading &&
    !providerAvailabilityQuery.error &&
    providerOptions.length > 0
  const credentialProviderId =
    hasSelectedProvider && areProviderOptionsReady
      ? resolveHeatmapCredentialProvider(providerId)
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
    () => (hasSelectedProvider ? getHeatmapTradingEnvironmentOptions(providerId) : []),
    [hasSelectedProvider, providerId]
  )
  const environment = hasSelectedProvider
    ? resolveHeatmapEnvironment(providerId, params?.environment)
    : undefined
  const accountsQuery = useTradingAccounts({
    provider: areProviderOptionsReady ? providerId : undefined,
    credentialId: activeCredentialId,
    environment: areProviderOptionsReady ? environment : undefined,
  })

  return (
    <div className={widgetHeaderButtonGroupClassName('min-w-0')}>
      <HeatmapTradingProviderSettingsButton
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
          emitHeatmapParamsChange({
            params: {
              tradingProvider: nextProvider,
              environment: resolveHeatmapEnvironment(nextProvider, null) ?? null,
              credentialId: null,
              accountId: null,
            },
            panelId,
            widgetKey,
          })
        }}
      />
      <div className='min-w-[220px]'>
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
            emitHeatmapParamsChange({
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

export const renderHeatmapHeader: DashboardWidgetDefinition['renderHeader'] = ({
  context,
  panelId,
  widget,
}) => {
  const widgetKey = widget?.key ?? 'heatmap'
  const params = (widget?.params as HeatmapWidgetParams | null | undefined) ?? null
  const sourceMode = resolveHeatmapSourceMode(params)

  return {
    left: (
      <HeatmapMarketControls
        workspaceId={context?.workspaceId}
        panelId={panelId}
        widgetKey={widgetKey}
        params={params}
      />
    ),
    center: <HeatmapSourceControls panelId={panelId} widgetKey={widgetKey} params={params} />,
    right:
      sourceMode === 'portfolio' ? (
        <HeatmapPortfolioControls panelId={panelId} widgetKey={widgetKey} params={params} />
      ) : null,
  }
}
