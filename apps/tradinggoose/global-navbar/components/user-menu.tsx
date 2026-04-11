'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronsUpDown,
  CreditCard,
  KeyRound,
  LifeBuoy,
  LogIn,
  LogOut,
  type LucideIcon,
  Monitor,
  Moon,
  ShieldCheck,
  Star,
  Sun,
  User,
  Users,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth-client'
import { canTierConfigureSso } from '@/lib/billing/tier-summary'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserRole } from '@/lib/organization/helpers'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import { getBaseUrl } from '@/lib/urls/utils'
import { HelpModal } from '@/global-navbar/settings-modal/components/help/help-modal'
import type { SettingsSection } from '@/global-navbar/settings-modal/types'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { clearUserData } from '@/stores'
import { useGeneralStore } from '@/stores/settings/general/store'
import { getInitials } from '../utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './resizable-dropdown'

type ThemeOption = {
  value: 'light' | 'system' | 'dark'
  label: string
  Icon: LucideIcon
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'dark', label: 'Dark', Icon: Moon },
]

const THEME_ITEM_BASE_CLASSES =
  'relative flex h-9 flex-1 items-center justify-center gap-0 rounded-md border px-0 py-0 text-sm transition-colors focus:bg-accent focus:text-accent-foreground'
const THEME_ITEM_ACTIVE_CLASSES = 'border-border bg-accent text-accent-foreground shadow-sm'
const THEME_ITEM_INACTIVE_CLASSES =
  'border-transparent text-muted-foreground hover:bg-card hover:text-foreground'

const DEFAULT_AVATAR_SRC = '/profile/avatar.png'

interface UserMenuProps {
  userName: string
  userEmail: string
  userAvatar?: string | null
  userAvatarVersion?: number | string | null
  userId?: string | null
  onOpenSettings?: (section: SettingsSection) => void
  canManageTeam?: boolean
  systemNavigation?: {
    href: string
    label: string
  } | null
}

export function UserMenu({
  userName,
  userEmail,
  userAvatar,
  userAvatarVersion,
  userId,
  onOpenSettings,
  canManageTeam,
  systemNavigation,
}: UserMenuProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false)
  const [avatarOverride, setAvatarOverride] = useState<{
    url: string | null
    version: number | string | null
  }>({ url: null, version: null })
  const logger = createLogger('UserMenu')
  const theme = useGeneralStore((state) => state.theme)
  const setTheme = useGeneralStore((state) => state.setTheme)
  const isGeneralLoading = useGeneralStore((state) => state.isLoading)
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const { data: organizationsData } = useOrganizations()
  const currentThemeLabel = THEME_OPTIONS.find((option) => option.value === theme)?.label ?? 'Theme'
  const [isSSOProviderOwner, setIsSSOProviderOwner] = useState<boolean | null>(null)
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false)
  const activeOrganization = organizationsData?.activeOrganization
  const activeOrganizationId = activeOrganization?.id
  const { data: organizationBillingData } = useOrganizationBilling(activeOrganizationId || '')
  const { data: subscriptionData, isLoading: isSubscriptionLoading } = useSubscriptionData()
  const billingPayload = (subscriptionData as any)?.data ?? subscriptionData
  const organizationBillingPayload =
    (organizationBillingData as any)?.data ?? organizationBillingData ?? null
  const billingEnabled =
    organizationBillingPayload?.billingEnabled ??
    billingPayload?.billingEnabled ??
    organizationsData?.billingData?.data?.billingEnabled ??
    true
  const subscription = getSubscriptionStatus(billingPayload)
  const isOrganizationPlan =
    organizationBillingPayload?.subscriptionTier?.ownerType === 'organization'
  const canConfigureSso = canTierConfigureSso(organizationBillingPayload?.subscriptionTier)
  const userRole = useMemo(
    () => getUserRole(activeOrganization, userEmail),
    [activeOrganization, userEmail]
  )
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const hasOrganization = Boolean(activeOrganizationId)
  const canManageSSOSettings = useMemo(() => {
    if (!hasOrganization || !isOrganizationPlan || !canConfigureSso) return false
    if (isHosted) {
      return isOwner || isAdmin
    }
    return isSSOProviderOwner === true
  }, [canConfigureSso, hasOrganization, isAdmin, isOrganizationPlan, isOwner, isSSOProviderOwner])

  useEffect(() => {
    if (!userId || typeof window === 'undefined') return

    const readStoredAvatar = () => {
      const storedVersion = window.localStorage.getItem(`user-avatar-version-${userId}`)
      const storedUrl = window.localStorage.getItem(`user-avatar-url-${userId}`)
      if (storedVersion || storedUrl !== null) {
        setAvatarOverride((prev) => ({
          url: storedUrl !== null ? storedUrl || null : prev.url,
          version: storedVersion ?? prev.version,
        }))
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (!event.key) return
      if (
        event.key === `user-avatar-version-${userId}` ||
        event.key === `user-avatar-url-${userId}`
      ) {
        readStoredAvatar()
      }
    }

    readStoredAvatar()
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [userId])

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<
        { url?: string | null; version?: number } | undefined
      >
      const detail = customEvent.detail
      setAvatarOverride((prev) => ({
        url: detail && 'url' in detail ? (detail?.url ?? null) : prev.url,
        version: detail && 'version' in detail ? (detail?.version ?? Date.now()) : Date.now(),
      }))
    }

    if (typeof window === 'undefined') {
      return
    }

    window.addEventListener('user-avatar-updated', handler)
    return () => window.removeEventListener('user-avatar-updated', handler)
  }, [])

  useEffect(() => {
    if (isHosted) {
      setIsSSOProviderOwner(null)
      return
    }

    if (!userId) {
      setIsSSOProviderOwner(false)
      return
    }

    let isMounted = true

    const fetchProviders = async () => {
      try {
        const response = await fetch('/api/auth/sso/providers')
        if (!response.ok) throw new Error('Failed to fetch providers')
        const data = await response.json()
        const ownsProvider = data.providers?.some((p: any) => p.userId === userId) || false
        if (isMounted) setIsSSOProviderOwner(ownsProvider)
      } catch {
        if (isMounted) setIsSSOProviderOwner(false)
      }
    }

    fetchProviders()

    return () => {
      isMounted = false
    }
  }, [userId])

  const effectiveAvatar = avatarOverride.url ?? userAvatar
  const effectiveVersion = avatarOverride.version ?? userAvatarVersion

  const avatarSrc = useMemo(() => {
    if (!effectiveAvatar) return null
    const numericVersion = Number(effectiveVersion)
    const versionValue =
      effectiveVersion && Number.isFinite(numericVersion)
        ? numericVersion
        : effectiveVersion
          ? encodeURIComponent(String(effectiveVersion))
          : null
    if (!versionValue) return effectiveAvatar
    const separator = effectiveAvatar.includes('?') ? '&' : '?'
    return `${effectiveAvatar}${separator}v=${versionValue}`
  }, [effectiveAvatar, effectiveVersion])

  const handleSignOut = async () => {
    if (isSigningOut) return
    setIsSigningOut(true)
    try {
      await Promise.all([signOut(), clearUserData()])
    } catch (error) {
      logger.error('Error signing out:', { error })
    } finally {
      router.push('/login?fromLogout=true')
      setIsSigningOut(false)
    }
  }

  const handleThemeChange = async (value: ThemeOption['value']) => {
    if (value === theme || isThemeLoading || isGeneralLoading) return
    try {
      await setTheme(value)
    } catch (error) {
      logger.error('Error updating theme:', { error })
    }
  }

  const handleOpenBillingPortal = async () => {
    if (!billingEnabled) return
    if (isOpeningBillingPortal || isSubscriptionLoading) return

    const context = isOrganizationPlan ? ('organization' as const) : ('user' as const)
    if (context === 'organization' && !activeOrganizationId) {
      logger.error('Cannot open billing portal without an active organization', {
        tier: subscription.tier.displayName,
      })
      alert('Select an organization to manage billing.')
      return
    }

    setIsOpeningBillingPortal(true)
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context,
          organizationId: context === 'organization' ? activeOrganizationId : undefined,
          returnUrl: `${getBaseUrl()}/workspace?billing=updated`,
        }),
      })

      const data = await res.json()
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || 'Failed to start billing portal')
      }
      window.location.href = data.url
    } catch (error) {
      logger.error('Failed to open billing portal from user menu', { error })
      alert(error instanceof Error ? error.message : 'Failed to open billing portal')
    } finally {
      setIsOpeningBillingPortal(false)
    }
  }

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                variant='default'
                size='lg'
                className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <Avatar className='h-8 w-8 rounded-md'>
                  {avatarSrc ? (
                    <AvatarImage key={avatarSrc} src={avatarSrc} alt={userName} />
                  ) : (
                    <AvatarImage src={DEFAULT_AVATAR_SRC} alt='Default avatar' />
                  )}
                  <AvatarFallback className='rounded-lg'>{getInitials(userName)}</AvatarFallback>
                </Avatar>
                <div className='grid flex-1 text-left text-sm leading-tight'>
                  <span className='truncate font-semibold'>{userName}</span>
                  <span className='truncate text-xs'>{userEmail}</span>
                </div>
                <ChevronsUpDown className='ml-auto size-4' />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className='w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 rounded-lg'
              sideOffset={4}
              align='start'
            >
              <DropdownMenuGroup>
                <div className='flex items-center gap-1.5 px-2 pt-0.5 pb-1.5'>
                  <DropdownMenuItem className='flex items-center gap-2 font-medium text-muted-foreground text-sm'>
                    {currentThemeLabel}
                  </DropdownMenuItem>
                  {THEME_OPTIONS.map(({ value, label, Icon }) => {
                    const isActive = theme === value
                    const themeClasses = `${THEME_ITEM_BASE_CLASSES} ${
                      isActive ? THEME_ITEM_ACTIVE_CLASSES : THEME_ITEM_INACTIVE_CLASSES
                    }`
                    return (
                      <DropdownMenuItem
                        key={value}
                        aria-label={`${label} theme`}
                        className={themeClasses}
                        disabled={isThemeLoading || isGeneralLoading}
                        onSelect={(event) => {
                          if (isActive) {
                            event.preventDefault()
                            return
                          }
                          void handleThemeChange(value)
                        }}
                        title={label}
                      >
                        <Icon className='size-4' />
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    if (onOpenSettings) {
                      onOpenSettings('account')
                    } else if (typeof window !== 'undefined') {
                      window.dispatchEvent(
                        new CustomEvent('open-settings', { detail: { tab: 'account' } })
                      )
                    }
                  }}
                >
                  <User />
                  Account Detail
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    if (onOpenSettings) {
                      onOpenSettings('service')
                    } else if (typeof window !== 'undefined') {
                      window.dispatchEvent(
                        new CustomEvent('open-settings', { detail: { tab: 'service' } })
                      )
                    }
                  }}
                >
                  <KeyRound />
                  Service API Keys
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {billingEnabled ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault()
                        if (onOpenSettings) {
                          onOpenSettings('subscription')
                        } else if (typeof window !== 'undefined') {
                          window.dispatchEvent(
                            new CustomEvent('open-settings', { detail: { tab: 'subscription' } })
                          )
                        }
                      }}
                    >
                      <Star />
                      Subscription
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isOpeningBillingPortal || isSubscriptionLoading}
                      onSelect={(event) => {
                        event.preventDefault()
                        void handleOpenBillingPortal()
                      }}
                    >
                      <CreditCard />
                      {isOpeningBillingPortal ? 'Opening Billing…' : 'Manage Billing'}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
              {canManageTeam || canManageSSOSettings ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {canManageTeam ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault()
                          if (onOpenSettings) {
                            onOpenSettings('team')
                          } else if (typeof window !== 'undefined') {
                            window.dispatchEvent(
                              new CustomEvent('open-settings', { detail: { tab: 'team' } })
                            )
                          }
                        }}
                      >
                        <Users />
                        Team Management
                      </DropdownMenuItem>
                    ) : null}
                    {canManageSSOSettings ? (
                      <DropdownMenuItem
                        onSelect={(event) => {
                          event.preventDefault()
                          if (onOpenSettings) {
                            onOpenSettings('sso')
                          } else if (typeof window !== 'undefined') {
                            window.dispatchEvent(
                              new CustomEvent('open-settings', { detail: { tab: 'sso' } })
                            )
                          }
                        }}
                      >
                        <LogIn />
                        Single Sign-On
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuGroup>
                </>
              ) : null}
              {systemNavigation ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.preventDefault()
                        router.push(systemNavigation.href)
                      }}
                    >
                      <ShieldCheck />
                      {systemNavigation.label}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onSelect={(event) => {
                    event.preventDefault()
                    setIsHelpModalOpen(true)
                  }}
                >
                  <LifeBuoy />
                  Help & Support
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSigningOut}
                onSelect={(event) => {
                  event.preventDefault()
                  void handleSignOut()
                }}
                className='text-destructive focus:text-destructive'
              >
                <LogOut className='text-destructive ' />
                {isSigningOut ? 'Logging out…' : 'Log out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <HelpModal open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen} />
    </>
  )
}
