import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, RefreshCw } from 'lucide-react'
import { useLocale } from 'next-intl'
import { OAuthRequiredModal } from '@/components/oauth/oauth-required-modal'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type Credential,
  getCanonicalScopesForProvider,
  getProviderIdFromServiceId,
  getServiceByProviderAndId,
  getServiceIdsFromScopes,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { cn } from '@/lib/utils'
import { useOAuthConnections } from '@/hooks/queries/oauth-connections'
import { useLatestRef } from '@/hooks/use-latest-ref'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { useWorkspaceBlockEditorMessages } from '@/i18n/workspace-widget-hooks'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ToolCredentialSelector')

interface ToolCredentialSelectorProps
  extends Pick<ButtonProps, 'aria-invalid' | 'aria-describedby'> {
  id?: string
  credentialSource?: 'workspace' | 'personal'
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  serviceId?: OAuthService
  serviceIds?: OAuthService[]
  workspaceId?: string
  disabled?: boolean
  triggerClassName?: string
}

export function ToolCredentialSelector({
  id,
  credentialSource = 'workspace',
  value,
  onChange,
  provider,
  requiredScopes,
  label,
  serviceId,
  serviceIds,
  workspaceId,
  disabled = false,
  triggerClassName,
  ...ariaProps
}: ToolCredentialSelectorProps) {
  const locale = useLocale() as LocaleCode
  const { toolInput: copy, dropdown } = useWorkspaceBlockEditorMessages()
  const [open, setOpen] = useState(false)
  const [workspaceCredentials, setCredentials] = useState<
    Array<Credential & { connectionId?: string }>
  >([])
  const [workspaceLoading, setIsLoading] = useState(false)
  const [connectServiceId, setConnectServiceId] = useState<OAuthService | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const selectionRequest = useRef(0)
  const activeWorkflowId = useOptionalWorkflowRoute()?.workflowId
  const isPersonal = credentialSource === 'personal'
  const effectiveServiceIds = useMemo(
    () =>
      Array.from(
        new Set(
          serviceIds?.length
            ? serviceIds
            : serviceId
              ? [serviceId]
              : getServiceIdsFromScopes(provider, requiredScopes ?? [])
        )
      ),
    [provider, requiredScopes, serviceId, serviceIds]
  )
  const selectionContext = JSON.stringify([
    provider,
    effectiveServiceIds,
    activeWorkflowId,
    workspaceId,
    credentialSource,
    disabled,
  ])
  const latestSelectionContext = useLatestRef(selectionContext)
  useEffect(() => {
    setIsSaving(false)
    setSaveError(null)
    return () => {
      selectionRequest.current += 1
    }
  }, [selectionContext])
  const baseProviderConfig = OAUTH_PROVIDERS[parseProvider(provider).baseProvider]
  const providerConfig =
    baseProviderConfig &&
    (effectiveServiceIds.length === 1
      ? getServiceByProviderAndId(provider, effectiveServiceIds[0])
      : baseProviderConfig)
  const {
    data: connections,
    isLoading: connectionsLoading,
    refetch,
  } = useOAuthConnections({ enabled: isPersonal && !disabled && !!providerConfig })
  const connectionService = connections?.find(
    (entry) => entry.providerId === getProviderIdFromServiceId(serviceId ?? provider)
  )
  const credentials: Array<Credential & { connectionId?: string }> = isPersonal
    ? (connectionService?.accounts ?? []).map((account) => ({
        ...account,
        provider: connectionService!.providerId,
        isOwner: true,
      }))
    : workspaceCredentials
  const isLoading = isPersonal ? connectionsLoading : workspaceLoading
  const labelText = label ?? translateWorkflowLabel(locale, 'selectCredential')

  useEffect(() => {
    if (disabled || !providerConfig) {
      setOpen(false)
      setConnectServiceId(null)
    }
  }, [disabled, providerConfig])

  const fetchCredentials = useCallback(async () => {
    if (!providerConfig) return
    if (isPersonal) {
      await refetch()
      return
    }
    setIsLoading(true)
    try {
      const providers = Array.from(new Set(effectiveServiceIds.map(getProviderIdFromServiceId)))
      const credentials = await Promise.all(
        providers.map(async (providerId) => {
          const params = new URLSearchParams({ provider: providerId })
          if (workspaceId) params.set('workspaceId', workspaceId)
          else if (activeWorkflowId) params.set('workflowId', activeWorkflowId)
          const response = await fetch(`/api/auth/oauth/credentials?${params.toString()}`)
          if (!response.ok) throw new Error(await response.text())
          const data = await response.json()
          return [
            ...data.credentials,
            ...data.connections.map((connection: Credential) => ({
              ...connection,
              connectionId: connection.id,
            })),
          ]
        })
      )
      setCredentials(credentials.flat())
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
      setCredentials([])
    } finally {
      setIsLoading(false)
    }
  }, [effectiveServiceIds, activeWorkflowId, workspaceId, isPersonal, providerConfig, refetch])

  useEffect(() => {
    if (!isPersonal) void fetchCredentials()
  }, [fetchCredentials, isPersonal, value])

  // Listen for visibility changes to update credentials when user returns from settings
  useEffect(() => {
    if (isPersonal) return
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCredentials()
      }
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void fetchCredentials()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [fetchCredentials, isPersonal])

  if (!providerConfig) {
    return (
      <Button
        {...ariaProps}
        id={id}
        aria-label={labelText}
        variant='outline'
        disabled
        className={cn('h-10 w-full min-w-0 justify-between', triggerClassName)}
      >
        {dropdown.noOptionsAvailable}
      </Button>
    )
  }

  const handleSelect = async (credential: Credential & { connectionId?: string }) => {
    if (disabled || isSaving) return
    const requestGeneration = ++selectionRequest.current
    const ownsRequest = () =>
      requestGeneration === selectionRequest.current &&
      selectionContext === latestSelectionContext.current
    setSaveError(null)
    let credentialId = credential.id
    if (credential.connectionId) {
      setIsSaving(true)
      try {
        const response = await fetch('/api/auth/oauth/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(workspaceId ? { workspaceId } : { workflowId: activeWorkflowId }),
            accountId: credential.connectionId,
          }),
        })
        const data = await response.json()
        if (!response.ok || typeof data.credentialId !== 'string') {
          throw new Error(copy.failedToSaveConnection)
        }
        credentialId = data.credentialId
      } catch {
        if (ownsRequest()) setSaveError(copy.failedToSaveConnection)
        return
      } finally {
        if (ownsRequest()) setIsSaving(false)
      }
    }
    if (!ownsRequest()) return
    onChange(credentialId)
    setOpen(false)
  }

  const handleOAuthClose = () => {
    setConnectServiceId(null)
    // Refetch credentials to include any new ones
    fetchCredentials()
  }

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      // Fetch fresh credentials when opening the dropdown
      fetchCredentials()
    }
  }

  const selectedCredential = credentials.find((cred) => cred.id === value && !cred.connectionId)
  const selectedLabel =
    selectedCredential?.isOwner === false
      ? translateWorkflowLabel(locale, 'savedByCollaborator')
      : selectedCredential?.name

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          disabled={disabled}
          render={
            <Button
              {...ariaProps}
              id={id}
              aria-label={labelText}
              variant='outline'
              role='combobox'
              aria-expanded={open}
              aria-busy={isSaving}
              className={cn('h-10 w-full min-w-0 justify-between', triggerClassName)}
              disabled={disabled}
            />
          }
        >
          <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
            {providerConfig.icon({ className: 'h-4 w-4' })}
            <span
              className={selectedLabel ? 'truncate font-normal' : 'truncate text-muted-foreground'}
            >
              {selectedLabel || labelText}
            </span>
          </div>
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder={translateWorkflowLabel(locale, 'searchCredentials')} />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>{translateWorkflowLabel(locale, 'loading')}</span>
                  </div>
                ) : credentials.length === 0 ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>
                      {translateWorkflowLabel(locale, 'noAccountsConnected')}
                    </p>
                    <p className='text-muted-foreground text-xs'>
                      {formatTemplate(copy.selectProviderAccount, {
                        provider: providerConfig.name,
                      })}
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>
                      {translateWorkflowLabel(locale, 'noAccountsFound')}
                    </p>
                  </div>
                )}
              </CommandEmpty>

              {credentials.length > 0 && (
                <CommandGroup>
                  {credentials.map((credential) => (
                    <CommandItem
                      key={credential.id}
                      value={credential.id}
                      keywords={[credential.name]}
                      disabled={disabled || isSaving}
                      onSelect={() => void handleSelect(credential)}
                    >
                      <div className='flex items-center gap-1'>
                        {getServiceByProviderAndId(credential.provider).icon({
                          className: 'h-4 w-4',
                        })}
                        <div>
                          <span className='font-normal'>
                            {credential.isOwner === false
                              ? translateWorkflowLabel(locale, 'savedByCollaborator')
                              : credential.name}
                          </span>
                          {effectiveServiceIds.length > 1 && (
                            <span className='ml-1 text-muted-foreground text-xs'>
                              {getServiceByProviderAndId(credential.provider).name}
                            </span>
                          )}
                          {credential.connectionId && (
                            <p className='text-muted-foreground text-xs'>{copy.useInWorkflow}</p>
                          )}
                        </div>
                      </div>
                      {credential.connectionId ? (
                        <Plus className='ml-auto h-4 w-4' />
                      ) : credential.id === value ? (
                        <Check className='ml-auto h-4 w-4' />
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              <CommandGroup>
                {effectiveServiceIds.map((serviceId) => (
                  <CommandItem
                    key={serviceId}
                    onSelect={() => {
                      setConnectServiceId(serviceId)
                      setOpen(false)
                    }}
                  >
                    <div className='flex items-center gap-1'>
                      <Plus className='h-4 w-4' />
                      <span className='font-normal'>
                        {formatTemplate(copy.selectProviderAccount, {
                          provider: getServiceByProviderAndId(provider, serviceId).name,
                        })}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {saveError && (
        <p role='alert' className='text-destructive text-xs'>
          {saveError}
        </p>
      )}

      <OAuthRequiredModal
        isOpen={connectServiceId !== null}
        onClose={handleOAuthClose}
        provider={provider}
        toolName={labelText}
        requiredScopes={
          isPersonal ? getCanonicalScopesForProvider(serviceId ?? provider) : requiredScopes
        }
        serviceId={connectServiceId ?? undefined}
      />
    </>
  )
}
