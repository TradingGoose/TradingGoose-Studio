'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Check, ChevronDown, ExternalLink, Search, Waypoints } from 'lucide-react'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { createLogger } from '@/lib/logs/console/logger'
import { startOAuthConnectFlow } from '@/lib/oauth/connect'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import { GlobalNavbarHeader } from '@/global-navbar'
import {
  disconnectOAuthService,
  oauthConnectionsKeys,
  type ServiceInfo,
  useOAuthConnections,
} from '@/hooks/queries/oauth-connections'
import { usePathname, useRouter } from '@/i18n/navigation'

const logger = createLogger('Integrations')

type IntegrationsFeedback = {
  kind: 'success' | 'error'
  message: string
}

export function Integrations() {
  const t = useTranslations('workspace.integrations')
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const pendingServiceRef = useRef<HTMLDivElement>(null)
  const integrationActionLockRef = useRef(false)
  const queryClient = useQueryClient()

  const {
    data: services = [],
    isError: connectionsFailed,
    isPending: servicesPending,
    refetch,
  } = useOAuthConnections()
  const connectService = useMutation({
    mutationFn: startOAuthConnectFlow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
    onError: (error) => {
      logger.error('OAuth connection error:', error)
    },
  })
  const disconnectService = useMutation({
    mutationFn: disconnectOAuthService,
    onMutate: async ({ accountId }) => {
      await queryClient.cancelQueries({ queryKey: oauthConnectionsKeys.connections() })
      const previousServices = queryClient.getQueryData<ServiceInfo[]>(
        oauthConnectionsKeys.connections()
      )

      if (previousServices) {
        queryClient.setQueryData<ServiceInfo[]>(
          oauthConnectionsKeys.connections(),
          previousServices.map((service) => {
            const accounts = service.accounts?.filter((account) => account.id !== accountId) || []
            return accounts.length === (service.accounts?.length ?? 0)
              ? service
              : { ...service, accounts, isConnected: accounts.length > 0 }
          })
        )
      }

      return { previousServices }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousServices) {
        queryClient.setQueryData(oauthConnectionsKeys.connections(), context.previousServices)
      }
      logger.error('Failed to disconnect service')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
    },
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [isConnecting, setIsConnecting] = useState<string | null>(null)
  const [pendingService, setPendingService] = useState<string | null>(null)
  const [actionFeedback, setActionFeedback] = useState<IntegrationsFeedback | null>(null)
  const [showActionRequired, setShowActionRequired] = useState(false)
  const [providerAvailability, setProviderAvailability] = useState<Record<string, boolean>>({})
  const [availabilityLoaded, setAvailabilityLoaded] = useState(false)
  const [availabilityFailed, setAvailabilityFailed] = useState(false)
  const isLoading = (servicesPending && services.length === 0) || !availabilityLoaded
  const hasLoadFailure = connectionsFailed || availabilityFailed
  const isPending = Boolean(isConnecting) || connectService.isPending || disconnectService.isPending
  const visibleFeedback =
    actionFeedback?.kind === 'error'
      ? actionFeedback
      : hasLoadFailure
        ? ({ kind: 'error', message: t('failures.load') } satisfies IntegrationsFeedback)
        : actionFeedback

  const providerIds = useMemo(() => {
    const ids = new Set<string>()
    Object.values(OAUTH_PROVIDERS).forEach((provider) => {
      Object.values(provider.services).forEach((service) => {
        if (service.providerId) ids.add(service.providerId)
      })
    })
    return Array.from(ids)
  }, [])

  useEffect(() => {
    let isMounted = true
    setAvailabilityFailed(false)

    const loadAvailability = async () => {
      try {
        const query = providerIds.length
          ? `?providers=${encodeURIComponent(providerIds.join(','))}`
          : ''
        const response = await fetch(`/api/auth/oauth/providers${query}`, {
          cache: 'no-store',
        })
        if (!response.ok) {
          throw new Error('Provider availability request failed')
        }
        const data = (await response.json()) as Record<string, boolean>
        if (!isMounted) return
        setProviderAvailability(data)
      } catch (error) {
        logger.error('Failed to load provider availability', error)
        if (isMounted) {
          setAvailabilityFailed(true)
        }
      } finally {
        if (isMounted) {
          setAvailabilityLoaded(true)
        }
      }
    }

    void loadAvailability()

    return () => {
      isMounted = false
    }
  }, [providerIds])

  // Check for OAuth callback
  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorDescription = searchParams.get('error_description')
    const trelloConnected = searchParams.get('trello_connected')

    // Handle OAuth callback
    if ((code && state) || trelloConnected === '1') {
      setActionFeedback(null)
      // This is an OAuth callback - try to restore state from localStorage
      try {
        const stored = localStorage.getItem('pending_oauth_state')
        if (stored) {
          const oauthState = JSON.parse(stored)
          logger.info('OAuth callback with restored state:', oauthState)

          // Mark as pending if we have context about what service was being connected
          if (oauthState.serviceId) {
            setPendingService(oauthState.serviceId)
            setShowActionRequired(true)
          }

          // Clean up the state (one-time use)
          localStorage.removeItem('pending_oauth_state')
        } else {
          logger.warn('OAuth callback but no state found in localStorage')
        }
      } catch (error) {
        logger.error('Error loading OAuth state from localStorage:', error)
        localStorage.removeItem('pending_oauth_state') // Clean up corrupted state
      }

      setActionFeedback({ kind: 'success', message: t('successMessage') })

      // Refresh connections to show the new connection
      refetch().catch((error) => logger.error('Failed to refresh services after OAuth', error))

      // Clear the URL parameters
      router.replace(`/workspace/${workspaceId}/integrations`)
    } else if (error) {
      const message = errorDescription || t('failures.oauth')
      logger.error('OAuth error:', { error, errorDescription })
      setActionFeedback({ kind: 'error', message })
      router.replace(`/workspace/${workspaceId}/integrations`)
    }
  }, [refetch, router, searchParams, t, workspaceId])

  // Handle connect button click
  const handleConnect = async (service: ServiceInfo) => {
    if (integrationActionLockRef.current || isPending) return
    integrationActionLockRef.current = true

    try {
      setIsConnecting(service.id)
      setActionFeedback(null)

      logger.info('Connecting service:', {
        serviceId: service.id,
        providerId: service.providerId,
        scopes: service.scopes,
      })

      if (typeof window !== 'undefined') {
        localStorage.setItem(
          'pending_oauth_state',
          JSON.stringify({ serviceId: service.id, scopes: service.scopes })
        )
      }

      await connectService.mutateAsync({
        providerId: service.providerId,
        callbackURL: `${pathname}${window.location.search}${window.location.hash}`,
      })
    } catch {
      setActionFeedback({ kind: 'error', message: t('failures.oauth') })
    } finally {
      integrationActionLockRef.current = false
      setIsConnecting(null)
    }
  }

  // Handle disconnect button click
  const handleDisconnect = async (service: ServiceInfo, accountId: string) => {
    if (integrationActionLockRef.current || isPending) return
    integrationActionLockRef.current = true
    const disconnectKey = `${service.id}-${accountId}`
    setIsConnecting(disconnectKey)
    setActionFeedback(null)
    try {
      await disconnectService.mutateAsync({
        accountId,
      })
    } catch (error) {
      const code =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : null
      setActionFeedback({
        kind: 'error',
        message:
          code === 'EXTERNAL_SUBSCRIPTION_IN_USE'
            ? t('failures.disconnectInUse')
            : t('failures.disconnect'),
      })
    } finally {
      integrationActionLockRef.current = false
      setIsConnecting(null)
    }
  }

  const connectibleServices = useMemo(() => {
    if (!availabilityLoaded) return []
    return services.filter((service) => Boolean(providerAvailability[service.providerId]))
  }, [services, providerAvailability, availabilityLoaded])

  // Group services by provider
  const groupedServices = connectibleServices.reduce(
    (acc, service) => {
      // Find the provider for this service
      const providerKey =
        Object.keys(OAUTH_PROVIDERS).find((key) =>
          Object.keys(OAUTH_PROVIDERS[key].services).includes(service.id)
        ) || 'other'

      if (!acc[providerKey]) {
        acc[providerKey] = []
      }

      acc[providerKey].push(service)
      return acc
    },
    {} as Record<string, ServiceInfo[]>
  )

  // Filter services based on search term
  const filteredGroupedServices = Object.entries(groupedServices).reduce(
    (acc, [providerKey, providerServices]) => {
      const filteredServices = providerServices.filter(
        (service) =>
          service.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          service.description.toLowerCase().includes(searchTerm.toLowerCase())
      )

      if (filteredServices.length > 0) {
        acc[providerKey] = filteredServices
      }

      return acc
    },
    {} as Record<string, ServiceInfo[]>
  )

  const scrollToHighlightedService = () => {
    if (pendingServiceRef.current) {
      pendingServiceRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }

  const headerLeftContent = (
    <div className='flex w-full flex-1 items-center gap-3'>
      <div className='hidden items-center gap-2 sm:flex'>
        <Waypoints className='h-[18px] w-[18px] text-muted-foreground' />
        <span className='font-medium text-sm'>{t('title')}</span>
      </div>
      <div className='flex w-full max-w-xl flex-1'>
        <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3 transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <GlobalNavbarHeader left={headerLeftContent} />
      <div className='flex flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-hidden'>
            <div className='flex-1 overflow-auto'>
              <div className='relative flex h-full flex-col p-1'>
                <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto p-6'>
                  {visibleFeedback ? (
                    <Alert
                      variant={visibleFeedback.kind === 'error' ? 'destructive' : 'default'}
                      role={visibleFeedback.kind === 'error' ? 'alert' : 'status'}
                      aria-live={visibleFeedback.kind === 'success' ? 'polite' : undefined}
                      aria-atomic='true'
                      className={
                        visibleFeedback.kind === 'success'
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : undefined
                      }
                    >
                      {visibleFeedback.kind === 'success' ? (
                        <Check aria-hidden='true' />
                      ) : (
                        <AlertCircle aria-hidden='true' />
                      )}
                      <AlertDescription>{visibleFeedback.message}</AlertDescription>
                    </Alert>
                  ) : null}

                  {/* Pending service message */}
                  {pendingService && showActionRequired && (
                    <div className='flex items-start gap-3 rounded-sm border border-primary/20 bg-[var(--primary)]/5 p-5 text-sm shadow-sm'>
                      <div className='mt-0.5 min-w-5'>
                        <ExternalLink className='h-4 w-4 text-muted-foreground' />
                      </div>
                      <div className='flex flex-1 flex-col'>
                        <p className='text-muted-foreground'>
                          <span className='font-medium text-foreground'>
                            {t('actionRequired.title')}
                          </span>{' '}
                          {t('actionRequired.description')}
                        </p>
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={scrollToHighlightedService}
                          className='mt-3 flex h-8 items-center gap-1.5 self-start border-primary/20 px-3 font-medium text-muted-foreground text-sm transition-colors hover:border-primary hover:bg-[var(--primary)]/10 hover:text-muted-foreground'
                        >
                          <span>{t('actionRequired.button')}</span>
                          <ChevronDown className='h-3.5 w-3.5' />
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {isLoading ? (
                    <div className='flex flex-col gap-6'>
                      {/* Google section - 5 blocks */}
                      <div className='flex flex-col gap-2'>
                        <Skeleton className='h-4 w-16' /> {/* "GOOGLE" label */}
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                      </div>
                      {/* Microsoft section - 6 blocks */}
                      <div className='flex flex-col gap-2'>
                        <Skeleton className='h-4 w-20' /> {/* "MICROSOFT" label */}
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                        <ConnectionSkeleton />
                      </div>
                    </div>
                  ) : (
                    <div className='flex flex-col gap-6'>
                      {/* Services list */}
                      {Object.entries(filteredGroupedServices).map(
                        ([providerKey, providerServices]) => (
                          <div key={providerKey} className='flex flex-col gap-2'>
                            <Label className='font-normal text-muted-foreground text-xs uppercase'>
                              {OAUTH_PROVIDERS[providerKey]?.name || t('otherServices')}
                            </Label>
                            {providerServices.map((service) => (
                              <div
                                key={service.id}
                                className={cn(
                                  'flex items-center justify-between gap-4',
                                  pendingService === service.id &&
                                    '-m-2 rounded-sm bg-[var(--primary)]/5 p-2'
                                )}
                                ref={pendingService === service.id ? pendingServiceRef : undefined}
                              >
                                <div className='flex items-center gap-3'>
                                  <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-secondary'>
                                    {typeof service.icon === 'function'
                                      ? service.icon({ className: 'h-5 w-5' })
                                      : service.icon}
                                  </div>
                                  <div className='min-w-0'>
                                    <div className='flex items-center gap-2'>
                                      <span className='font-normal text-sm'>{service.name}</span>
                                    </div>
                                    <p className='truncate text-muted-foreground text-xs'>
                                      {service.description}
                                    </p>
                                  </div>
                                </div>

                                {service.accounts && service.accounts.length > 0 ? (
                                  <div className='flex min-w-0 flex-col gap-1'>
                                    {service.accounts.map((account) => {
                                      const disconnectKey = `${service.id}-${account.id}`
                                      return (
                                        <div
                                          key={account.id}
                                          className='flex items-center justify-end gap-2'
                                        >
                                          <span className='max-w-56 truncate text-muted-foreground text-xs'>
                                            {account.name}
                                          </span>
                                          <Button
                                            variant='ghost'
                                            size='sm'
                                            onClick={() => handleDisconnect(service, account.id)}
                                            disabled={isPending}
                                            focusableWhenDisabled={isConnecting === disconnectKey}
                                            aria-busy={isConnecting === disconnectKey || undefined}
                                            className={cn(
                                              'h-8 text-muted-foreground hover:text-foreground',
                                              isPending && 'cursor-not-allowed'
                                            )}
                                          >
                                            {isConnecting === disconnectKey
                                              ? t('disconnecting')
                                              : t('disconnect')}
                                          </Button>
                                        </div>
                                      )
                                    })}
                                  </div>
                                ) : (
                                  <Button
                                    variant='outline'
                                    size='sm'
                                    onClick={() => handleConnect(service)}
                                    disabled={isPending}
                                    focusableWhenDisabled={isConnecting === service.id}
                                    aria-busy={isConnecting === service.id || undefined}
                                    className={cn('h-8', isPending && 'cursor-not-allowed')}
                                  >
                                    {isConnecting === service.id ? t('connecting') : t('connect')}
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )
                      )}

                      {!isLoading &&
                        !hasLoadFailure &&
                        !searchTerm.trim() &&
                        Object.keys(filteredGroupedServices).length === 0 && (
                          <div className='py-8 text-center text-muted-foreground text-sm'>
                            {t('emptyState.noConnectible')}
                          </div>
                        )}

                      {/* Show message when search has no results */}
                      {!hasLoadFailure &&
                        searchTerm.trim() &&
                        Object.keys(filteredGroupedServices).length === 0 && (
                          <div className='py-8 text-center text-muted-foreground text-sm'>
                            {t('emptyState.noSearchMatches', { query: searchTerm })}
                          </div>
                        )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Loading skeleton for connections
function ConnectionSkeleton() {
  return (
    <div className='flex items-center justify-between gap-4'>
      <div className='flex items-center gap-3'>
        <Skeleton className='h-10 w-10 rounded-sm' />
        <div className='space-y-1'>
          <Skeleton className='h-5 w-24' />
          <Skeleton className='h-4 w-32' />
        </div>
      </div>
      <Skeleton className='h-8 w-20' />
    </div>
  )
}
