import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Plus, RefreshCw } from 'lucide-react'
import { useLocale } from 'next-intl'
import { OAuthRequiredModal } from '@/components/oauth/oauth-required-modal'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type Credential,
  getCanonicalScopesForProvider,
  OAUTH_PROVIDERS,
  type OAuthProvider,
  type OAuthService,
  parseProvider,
} from '@/lib/oauth'
import { useOAuthConnections } from '@/hooks/queries/oauth-connections'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { formatTemplate } from '@/i18n/utils'
import { useWorkspaceBlockEditorMessages } from '@/i18n/workspace-widget-hooks'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('ToolCredentialSelector')

// Helper functions for provider icons and names
const getProviderIcon = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (!baseProviderConfig) {
    return <ExternalLink className='h-4 w-4' />
  }
  // Always use the base provider icon for a more consistent UI
  return baseProviderConfig.icon({ className: 'h-4 w-4' })
}

const getProviderName = (providerName: OAuthProvider) => {
  const { baseProvider } = parseProvider(providerName)
  const baseProviderConfig = OAUTH_PROVIDERS[baseProvider]

  if (baseProviderConfig) {
    return baseProviderConfig.name
  }

  // Format provider ids that are not present in static OAuth metadata.
  return providerName
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

interface ToolCredentialSelectorProps {
  id?: string
  credentialSource?: 'workspace' | 'personal'
  value: string
  onChange: (value: string) => void
  provider: OAuthProvider
  requiredScopes?: string[]
  label?: string
  serviceId?: OAuthService
  disabled?: boolean
}

export function ToolCredentialSelector({
  id,
  credentialSource = 'workspace',
  value,
  onChange,
  provider,
  requiredScopes = [],
  label,
  serviceId,
  disabled = false,
}: ToolCredentialSelectorProps) {
  const locale = useLocale() as LocaleCode
  const copy = useWorkspaceBlockEditorMessages().toolInput
  const [open, setOpen] = useState(false)
  const [workspaceCredentials, setCredentials] = useState<Credential[]>([])
  const [workspaceLoading, setIsLoading] = useState(false)
  const [showOAuthModal, setShowOAuthModal] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const activeWorkflowId = useOptionalWorkflowRoute()?.workflowId
  const isPersonal = credentialSource === 'personal'
  const {
    data: connections,
    isLoading: connectionsLoading,
    refetch,
  } = useOAuthConnections({ enabled: isPersonal && !disabled })
  const connectionService = connections?.find(
    (entry) => entry.providerId === (serviceId ?? provider)
  )
  const credentials = isPersonal
    ? (connectionService?.accounts ?? []).map((account) => ({
        ...account,
        provider: connectionService!.providerId,
        isOwner: true,
      }))
    : workspaceCredentials
  const isLoading = isPersonal ? connectionsLoading : workspaceLoading
  const labelText = label ?? translateWorkflowLabel(locale, 'selectCredential')

  // Update selected ID when value changes
  useEffect(() => {
    setSelectedId(value)
  }, [value])

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setShowOAuthModal(false)
    }
  }, [disabled])

  const fetchCredentials = useCallback(async () => {
    if (isPersonal) {
      await refetch()
      return
    }
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ provider })
      if (activeWorkflowId) params.set('workflowId', activeWorkflowId)
      const response = await fetch(`/api/auth/oauth/credentials?${params.toString()}`)
      if (response.ok) {
        const data = await response.json()
        setCredentials(data.credentials || [])
      } else {
        logger.error('Error fetching credentials:', { error: await response.text() })
        setCredentials([])
      }
    } catch (error) {
      logger.error('Error fetching credentials:', { error })
      setCredentials([])
    } finally {
      setIsLoading(false)
    }
  }, [provider, activeWorkflowId, isPersonal, refetch])

  useEffect(() => {
    if (!isPersonal) void fetchCredentials()
  }, [fetchCredentials, isPersonal])

  // Listen for visibility changes to update credentials when user returns from settings
  useEffect(() => {
    if (isPersonal) return
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchCredentials()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetchCredentials, isPersonal])

  const handleSelect = (credentialId: string) => {
    if (disabled) return
    setSelectedId(credentialId)
    onChange(credentialId)
    setOpen(false)
  }

  const handleOAuthClose = () => {
    setShowOAuthModal(false)
    // Refetch credentials to include any new ones
    fetchCredentials()
  }

  // Handle popover open to fetch fresh credentials
  const handleOpenChange = (isOpen: boolean) => {
    setOpen((prev) => (prev === isOpen ? prev : isOpen))
    if (isOpen) {
      // Fetch fresh credentials when opening the dropdown
      fetchCredentials()
    }
  }

  const selectedCredential = credentials.find((cred) => cred.id === selectedId)
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
              id={id}
              aria-label={labelText}
              variant='outline'
              role='combobox'
              aria-expanded={open}
              className='h-10 w-full min-w-0 justify-between'
              disabled={disabled}
            />
          }
        >
          <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
            {getProviderIcon(provider)}
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
                        provider: getProviderName(provider),
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
                      onSelect={() => handleSelect(credential.id)}
                    >
                      <div className='flex items-center gap-1'>
                        {getProviderIcon(credential.provider)}
                        <span className='font-normal'>
                          {credential.isOwner === false
                            ? translateWorkflowLabel(locale, 'savedByCollaborator')
                            : credential.name}
                        </span>
                      </div>
                      {credential.id === selectedId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              <CommandGroup>
                <CommandItem onSelect={() => setShowOAuthModal(true)}>
                  <div className='flex items-center gap-1'>
                    <Plus className='h-4 w-4' />
                    <span className='font-normal'>
                      {formatTemplate(copy.selectProviderAccount, {
                        provider: getProviderName(provider),
                      })}
                    </span>
                  </div>
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <OAuthRequiredModal
        isOpen={showOAuthModal}
        onClose={handleOAuthClose}
        provider={provider}
        toolName={labelText}
        requiredScopes={
          isPersonal ? getCanonicalScopesForProvider(serviceId ?? provider) : requiredScopes
        }
        serviceId={serviceId}
      />
    </>
  )
}
