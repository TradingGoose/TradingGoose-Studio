'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ExternalLink, Search, Waypoints } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
    type ServiceInfo,
    useConnectOAuthService,
    useDisconnectOAuthService,
    useOAuthConnections,
} from '@/hooks/queries/oauth-connections'
import { createLogger } from '@/lib/logs/console/logger'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { cn } from '@/lib/utils'
import { GlobalNavbarHeader } from '@/global-navbar'

const logger = createLogger('Integrations')

export function Integrations() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const params = useParams()
    const workspaceId = params.workspaceId as string
    const pendingServiceRef = useRef<HTMLDivElement>(null)

    const { data: services = [], isPending: servicesPending, refetch } = useOAuthConnections()
    const connectService = useConnectOAuthService()
    const disconnectService = useDisconnectOAuthService()
    const [searchTerm, setSearchTerm] = useState('')
    const [isConnecting, setIsConnecting] = useState<string | null>(null)
    const [pendingService, setPendingService] = useState<string | null>(null)
    const [authSuccess, setAuthSuccess] = useState(false)
    const [showActionRequired, setShowActionRequired] = useState(false)
    const [providerAvailability, setProviderAvailability] = useState<Record<string, boolean>>({})
    const [availabilityLoaded, setAvailabilityLoaded] = useState(false)
    const isLoading = (servicesPending && services.length === 0) || !availabilityLoaded

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

        const loadAvailability = async () => {
            try {
                const query = providerIds.length
                    ? `?providers=${encodeURIComponent(providerIds.join(','))}`
                    : ''
                const response = await fetch(`/api/auth/oauth/providers${query}`, {
                    cache: 'no-store',
                })
                if (!response.ok) return
                const data = (await response.json()) as Record<string, boolean>
                if (!isMounted) return
                setProviderAvailability(data)
            } catch (error) {
                logger.error('Failed to load provider availability', error)
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

        // Handle OAuth callback
        if (code && state) {
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

            // Set success flag
            setAuthSuccess(true)

            // Refresh connections to show the new connection
            refetch().catch((error) => logger.error('Failed to refresh services after OAuth', error))

            // Clear the URL parameters
            router.replace(`/workspace/${workspaceId}/integrations`)
        } else if (error) {
            logger.error('OAuth error:', { error })
            router.replace(`/workspace/${workspaceId}/integrations`)
        }
    }, [searchParams, router, workspaceId, refetch])

    // Handle connect button click
    const handleConnect = async (service: ServiceInfo) => {
        try {
            setIsConnecting(service.id)

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
                callbackURL: window.location.href,
            })
        } catch (error) {
            logger.error('OAuth connection error:', { error })
        } finally {
            setIsConnecting(null)
        }
    }

    // Handle disconnect button click
    const handleDisconnect = async (service: ServiceInfo, accountId: string) => {
        setIsConnecting(`${service.id}-${accountId}`)
        try {
            await disconnectService.mutateAsync({
                provider: service.providerId.split('-')[0],
                providerId: service.providerId,
                serviceId: service.id,
                accountId,
            })
        } catch (error) {
            logger.error('Error disconnecting service:', { error })
        } finally {
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
                <span className='font-medium text-sm'>Integrations</span>
            </div>
            <div className='flex w-full max-w-xl flex-1'>
                <div className='flex h-9 w-full items-center gap-2 rounded-lg border bg-background pr-2 pl-3'>
                    <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
                    <Input
                        placeholder='Search integrations...'
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

                                    {/* Success message */}
                                    {authSuccess && (
                                        <div className='rounded-sm border border-green-200 bg-green-50 p-4'>
                                            <div className='flex'>
                                                <div className='flex-shrink-0'>
                                                    <Check className='h-5 w-5 text-green-400' />
                                                </div>
                                                <div className='ml-3'>
                                                    <p className='font-medium text-green-800 text-sm'>
                                                        Account connected successfully!
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Pending service message */}
                                    {pendingService && showActionRequired && (
                                        <div className='flex items-start gap-3 rounded-sm border border-primary/20 bg-[var(--primary)]/5 p-5 text-sm shadow-sm'>
                                            <div className='mt-0.5 min-w-5'>
                                                <ExternalLink className='h-4 w-4 text-muted-foreground' />
                                            </div>
                                            <div className='flex flex-1 flex-col'>
                                                <p className='text-muted-foreground'>
                                                    <span className='font-medium text-foreground'>Action Required:</span> Please
                                                    connect your account to enable the requested features. The required service is
                                                    highlighted below.
                                                </p>
                                                <Button
                                                    variant='outline'
                                                    size='sm'
                                                    onClick={scrollToHighlightedService}
                                                    className='mt-3 flex h-8 items-center gap-1.5 self-start border-primary/20 px-3 font-medium text-muted-foreground text-sm transition-colors hover:border-primary hover:bg-[var(--primary)]/10 hover:text-muted-foreground'
                                                >
                                                    <span>Go to service</span>
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
                                                            {OAUTH_PROVIDERS[providerKey]?.name || 'Other Services'}
                                                        </Label>
                                                        {providerServices.map((service) => (
                                                            <div
                                                                key={service.id}
                                                                className={cn(
                                                                    'flex items-center justify-between gap-4',
                                                                    pendingService === service.id &&
                                                                    '-m-2 rounded-sm bg-[var(--primary)]/5 p-2'
                                                                )}
                                                                ref={
                                                                    pendingService === service.id
                                                                        ? pendingServiceRef
                                                                        : undefined
                                                                }
                                                            >
                                                                <div className='flex items-center gap-3'>
                                                                    <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-secondary'>
                                                                        {typeof service.icon === 'function'
                                                                            ? service.icon({ className: 'h-5 w-5' })
                                                                            : service.icon}
                                                                    </div>
                                                                    <div className='min-w-0'>
                                                                        <div className='flex items-center gap-2'>
                                                                            <span className='font-normal text-sm'>
                                                                                {service.name}
                                                                            </span>
                                                                        </div>
                                                                        {service.accounts &&
                                                                            service.accounts.length > 0 ? (
                                                                            <p className='truncate text-muted-foreground text-xs'>
                                                                                {service.accounts
                                                                                    .map((a) => a.name)
                                                                                    .join(', ')}
                                                                            </p>
                                                                        ) : (
                                                                            <p className='truncate text-muted-foreground text-xs'>
                                                                                {service.description}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {service.accounts &&
                                                                    service.accounts.length > 0 ? (
                                                                    <Button
                                                                        variant='ghost'
                                                                        size='sm'
                                                                        onClick={() =>
                                                                            handleDisconnect(
                                                                                service,
                                                                                service.accounts![0].id
                                                                            )
                                                                        }
                                                                        disabled={
                                                                            isConnecting ===
                                                                            `${service.id}-${service.accounts![0].id}`
                                                                        }
                                                                        className={cn(
                                                                            'h-8 text-muted-foreground hover:text-foreground',
                                                                            isConnecting ===
                                                                            `${service.id}-${service.accounts![0].id}` &&
                                                                            'cursor-not-allowed'
                                                                        )}
                                                                    >
                                                                        Disconnect
                                                                    </Button>
                                                                ) : (
                                                                    <Button
                                                                        variant='outline'
                                                                        size='sm'
                                                                        onClick={() => handleConnect(service)}
                                                                        disabled={isConnecting === service.id}
                                                                        className={cn(
                                                                            'h-8',
                                                                            isConnecting === service.id &&
                                                                            'cursor-not-allowed'
                                                                        )}
                                                                    >
                                                                        Connect
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )
                                            )}

                                            {!isLoading &&
                                                !searchTerm.trim() &&
                                                Object.keys(filteredGroupedServices).length === 0 && (
                                                    <div className='py-8 text-center text-muted-foreground text-sm'>
                                                        No connectible integrations are configured.
                                                    </div>
                                                )}

                                            {/* Show message when search has no results */}
                                            {searchTerm.trim() &&
                                                Object.keys(filteredGroupedServices).length === 0 && (
                                                    <div className='py-8 text-center text-muted-foreground text-sm'>
                                                        No services found matching "{searchTerm}"
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
