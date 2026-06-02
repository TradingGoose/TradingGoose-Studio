'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
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
import { useSearchParams } from 'next/navigation'
import { useLocale, useMessages, useTranslations } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
} from '@/components/widget-header-control'
import { signOut } from '@/lib/auth-client'
import { openBillingPortal } from '@/lib/billing/billing-portal'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import { cn } from '@/lib/utils'
import { HelpModal } from '@/global-navbar/settings-modal/components/help/help-modal'
import type { SettingsSection } from '@/global-navbar/settings-modal/types'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { formatTemplate } from '@/i18n/client-messages'
import { usePathname, useRouter } from '@/i18n/navigation'
import {
  getLocaleDisplayName,
  isLocaleCode,
  type LocaleCode,
  locales,
} from '@/i18n/utils'
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
  Icon: LucideIcon
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', Icon: Sun },
  { value: 'system', Icon: Monitor },
  { value: 'dark', Icon: Moon },
]

const DEFAULT_AVATAR_SRC = '/profile/avatar.png'

interface UserMenuProps {
  userName: string
  userEmail: string
  userAvatar?: string | null
  userAvatarVersion?: number | string | null
  userId?: string | null
  onOpenSettings?: (section: SettingsSection) => void
  systemNavigation?: {
    href: string
    label: string
  } | null
}

type UserMenuMessages = {
  workspace?: {
    userMenu?: {
      themeLabel?: string
    }
  }
}

export function UserMenu({
  userName,
  userEmail,
  userAvatar,
  userAvatarVersion,
  userId,
  onOpenSettings,
  systemNavigation,
}: UserMenuProps) {
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const tUserMenu = useTranslations('workspace.userMenu')
  const messages = useMessages() as UserMenuMessages
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [isOpeningBillingPortal, setIsOpeningBillingPortal] = useState(false)
  const [avatarOverride, setAvatarOverride] = useState<{
    url: string | null
    version: number | string | null
  }>({ url: null, version: null })
  const logger = createLogger('UserMenu')
  const theme = useGeneralStore((state) => state.theme)
  const setTheme = useGeneralStore((state) => state.setTheme)
  const updateSetting = useGeneralStore((state) => state.updateSetting)
  const isGeneralLoading = useGeneralStore((state) => state.isLoading)
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const { data: organizationsData } = useOrganizations()
  const userMenuCopy = useMemo(
    () => ({
      accountDetail: tUserMenu('accountDetail'),
      helpSupport: tUserMenu('helpSupport'),
      serviceApiKeys: tUserMenu('serviceApiKeys'),
      subscription: tUserMenu('subscription'),
      manageBilling: tUserMenu('manageBilling'),
      openingBilling: tUserMenu('openingBilling'),
      teamManagement: tUserMenu('teamManagement'),
      singleSignOn: tUserMenu('singleSignOn'),
      logOut: tUserMenu('logOut'),
      loggingOut: tUserMenu('loggingOut'),
      billingPortalSelectOrganization: tUserMenu('billingPortalSelectOrganization'),
      billingPortalFailed: tUserMenu('billingPortalFailed'),
      languageLabel: tUserMenu('languageLabel'),
      themeOptions: {
        light: tUserMenu('themeOptions.light'),
        system: tUserMenu('themeOptions.system'),
        dark: tUserMenu('themeOptions.dark'),
      },
      defaultAvatarAlt: tUserMenu('defaultAvatarAlt'),
    }),
    [tUserMenu]
  )
  const themeOptionLabels = userMenuCopy.themeOptions
  const currentThemeOption =
    THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0]
  const currentThemeLabel = themeOptionLabels[currentThemeOption.value]
  // This label intentionally bypasses next-intl interpolation because workspace copy uses
  // {{token}} templates instead of ICU placeholders.
  const themeLabelTemplate = messages.workspace?.userMenu?.themeLabel ?? 'Theme: {{theme}}'
  const currentThemeAriaLabel = formatTemplate(themeLabelTemplate, { theme: currentThemeLabel })
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
  const isOrganizationPlan = subscription.tier.ownerType === 'organization'
  const userRole = useMemo(
    () => getUserRole(activeOrganization, userEmail),
    [activeOrganization, userEmail]
  )
  const isOwner = userRole === 'owner'
  const isAdmin = userRole === 'admin'
  const organizationAccess = getOrganizationAccessState({
    billingEnabled,
    hasOrganization: Boolean(activeOrganizationId),
    isOrganizationAdmin: isOwner || isAdmin,
    userTier: billingPayload?.tier,
    organizationTier: organizationBillingPayload?.subscriptionTier,
  })
  const canOpenTeamSettings = organizationAccess.canOpenTeamSettings
  const canManageSSOSettings = organizationAccess.canConfigureSso

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

  const handleLocaleChange = async (nextLocale: string) => {
    if (!isLocaleCode(nextLocale) || nextLocale === locale) {
      return
    }

    const href = search ? `${pathname}?${search}` : pathname
    try {
      await updateSetting('preferredLocale', nextLocale)
    } catch (error) {
      logger.error('Failed to persist preferred locale:', { error, locale: nextLocale })
    }
    router.replace(href, { locale: nextLocale })
  }

  const handleOpenBillingPortal = async () => {
    if (!billingEnabled) return
    if (isOpeningBillingPortal || isSubscriptionLoading) return

    const context = isOrganizationPlan ? ('organization' as const) : ('user' as const)
    if (context === 'organization' && !activeOrganizationId) {
      logger.error('Cannot open billing portal without an active organization', {
        tier: subscription.tier.displayName,
      })
      alert(userMenuCopy.billingPortalSelectOrganization)
      return
    }

    setIsOpeningBillingPortal(true)
    try {
      await openBillingPortal({
        context,
        organizationId: context === 'organization' ? activeOrganizationId : undefined,
      })
    } catch (error) {
      logger.error('Failed to open billing portal from user menu', { error })
      alert(error instanceof Error ? error.message : userMenuCopy.billingPortalFailed)
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
                    <AvatarImage src={DEFAULT_AVATAR_SRC} alt={userMenuCopy.defaultAvatarAlt} />
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
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        aria-haspopup='menu'
                        aria-label={currentThemeAriaLabel}
                        className={widgetHeaderControlClassName(
                          'group flex h-7 min-w-0 flex-1 justify-between gap-1.5 rounded-sm'
                        )}
                        disabled={isThemeLoading || isGeneralLoading}
                        title={currentThemeLabel}
                      >
                        <span className='flex min-w-0 items-center gap-1.5'>
                          <currentThemeOption.Icon
                            className='h-4 w-4 shrink-0 text-muted-foreground'
                            aria-hidden='true'
                          />
                          <span className='min-w-0 truncate text-left'>{currentThemeLabel}</span>
                        </span>
                        <ChevronDown
                          className='h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                          aria-hidden='true'
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      sideOffset={6}
                      className={cn(widgetHeaderMenuContentClassName, 'w-[220px]')}
                    >
                      {THEME_OPTIONS.map(({ value, Icon }) => {
                        const label = themeOptionLabels[value]
                        const isActive = theme === value

                        return (
                          <DropdownMenuItem
                            key={value}
                            className={cn(widgetHeaderMenuItemClassName, 'items-center')}
                            disabled={isThemeLoading || isGeneralLoading}
                            onSelect={(event) => {
                              if (isActive) {
                                event.preventDefault()
                                return
                              }
                              void handleThemeChange(value)
                            }}
                          >
                            <Icon
                              className={cn(
                                'h-4 w-4 text-muted-foreground',
                                isActive && 'text-foreground'
                              )}
                              aria-hidden='true'
                            />
                            <span className='min-w-0 truncate'>{label}</span>
                            {isActive ? (
                              <Check className='ml-auto h-3.5 w-3.5 text-primary' />
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        aria-haspopup='menu'
                        aria-label={`${userMenuCopy.languageLabel}: ${getLocaleDisplayName(locale)}`}
                        className={widgetHeaderControlClassName(
                          'group flex h-7 min-w-0 flex-1 justify-between gap-1.5 rounded-sm'
                        )}
                        title={getLocaleDisplayName(locale)}
                      >
                        <span className='min-w-0 truncate text-left'>
                          {getLocaleDisplayName(locale)}
                        </span>
                        <ChevronDown
                          className='h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                          aria-hidden='true'
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      sideOffset={6}
                      className={cn(widgetHeaderMenuContentClassName, 'w-[220px]')}
                    >
                      {locales.map((code) => {
                        const isActive = code === locale

                        return (
                          <DropdownMenuItem
                            key={code}
                            className={cn(widgetHeaderMenuItemClassName, 'items-center')}
                            onSelect={(event) => {
                              if (isActive) {
                                event.preventDefault()
                                return
                              }
                              handleLocaleChange(code)
                            }}
                          >
                            <span className='min-w-0 truncate'>{getLocaleDisplayName(code)}</span>
                            {isActive ? (
                              <Check className='ml-auto h-3.5 w-3.5 text-primary' />
                            ) : null}
                          </DropdownMenuItem>
                        )
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
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
                  {userMenuCopy.accountDetail}
                </DropdownMenuItem>
                {isHosted ? (
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
                    {userMenuCopy.serviceApiKeys}
                  </DropdownMenuItem>
                ) : null}
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
                      {userMenuCopy.subscription}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={isOpeningBillingPortal || isSubscriptionLoading}
                      onSelect={(event) => {
                        event.preventDefault()
                        void handleOpenBillingPortal()
                      }}
                    >
                      <CreditCard />
                      {isOpeningBillingPortal
                        ? userMenuCopy.openingBilling
                        : userMenuCopy.manageBilling}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              ) : null}
              {canOpenTeamSettings || canManageSSOSettings ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    {canOpenTeamSettings ? (
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
                        {userMenuCopy.teamManagement}
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
                        {userMenuCopy.singleSignOn}
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
                  {userMenuCopy.helpSupport}
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
                {isSigningOut ? userMenuCopy.loggingOut : userMenuCopy.logOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <HelpModal open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen} />
    </>
  )
}
