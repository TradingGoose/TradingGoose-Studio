'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronsUpDown,
  CreditCard,
  ChevronDown,
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
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale } from 'next-intl'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth-client'
import { openBillingPortal } from '@/lib/billing/billing-portal'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
import { getSubscriptionStatus } from '@/lib/subscription/helpers'
import {
  buildLocaleSwitchHref,
  navigateToLocaleHref,
} from '@/app/(landing)/components/nav/locale-switcher'
import { HelpModal } from '@/global-navbar/settings-modal/components/help/help-modal'
import type { SettingsSection } from '@/global-navbar/settings-modal/types'
import { useOrganizationBilling, useOrganizations } from '@/hooks/queries/organization'
import { useSubscriptionData } from '@/hooks/queries/subscription'
import { usePathname } from '@/i18n/navigation'
import { formatTemplate, getPublicCopy } from '@/i18n/public-copy'
import { isLocaleCode, type LocaleCode, locales, localizeHref } from '@/i18n/utils'
import { clearUserData } from '@/stores'
import { useGeneralStore } from '@/stores/settings/general/store'
import { getInitials } from '../utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

const SELECTOR_TRIGGER_BASE_CLASSES =
  'flex h-9 cursor-pointer items-center rounded-md border border-border px-2 py-0 font-medium text-foreground text-sm transition-colors hover:bg-card focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground disabled:pointer-events-none disabled:opacity-50'
const THEME_SELECTOR_TRIGGER_CLASSES = `${SELECTOR_TRIGGER_BASE_CLASSES} w-9 justify-center px-0 [&>svg:last-child]:hidden`
const LOCALE_SELECTOR_TRIGGER_CLASSES = `${SELECTOR_TRIGGER_BASE_CLASSES} min-w-0 flex-1 justify-between gap-2 [&>svg:last-child]:hidden`
const SELECTOR_SUBMENU_CONTENT_CLASSES = 'w-48 rounded-lg'

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
  const copy = getPublicCopy(locale)
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
  const userMenuCopy = copy.workspace.userMenu
  const themeOptionLabels = userMenuCopy.themeOptions
  const currentThemeOption =
    THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0]
  const currentThemeLabel = themeOptionLabels[currentThemeOption.value]
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
      router.push(localizeHref(locale, '/login?fromLogout=true'))
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

  const handleLocaleChange = (nextLocale: string) => {
    if (!isLocaleCode(nextLocale) || nextLocale === locale) {
      return
    }

    navigateToLocaleHref(buildLocaleSwitchHref(nextLocale, pathname, searchParams))
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
                <div className='grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-1.5 px-2 pt-0.5 pb-1.5'>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      aria-label={formatTemplate(userMenuCopy.themeLabel, {
                        theme: currentThemeLabel,
                      })}
                      className={THEME_SELECTOR_TRIGGER_CLASSES}
                      disabled={isThemeLoading || isGeneralLoading}
                      title={currentThemeLabel}
                    >
                      <currentThemeOption.Icon className='size-4' />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className={SELECTOR_SUBMENU_CONTENT_CLASSES}>
                      <DropdownMenuRadioGroup value={theme}>
                        {THEME_OPTIONS.map(({ value, Icon }) => {
                          const label = themeOptionLabels[value]
                          const isActive = theme === value

                          return (
                            <DropdownMenuRadioItem
                              key={value}
                              className='flex items-center gap-2'
                              disabled={isThemeLoading || isGeneralLoading}
                              onSelect={(event) => {
                                if (isActive) {
                                  event.preventDefault()
                                  return
                                }
                                void handleThemeChange(value)
                              }}
                              value={value}
                            >
                              <Icon className='size-4' />
                              {label}
                            </DropdownMenuRadioItem>
                          )
                        })}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger
                      className={LOCALE_SELECTOR_TRIGGER_CLASSES}
                      title={copy.localeNames[locale]}
                    >
                      <span className='min-w-0 truncate'>{copy.localeNames[locale]}</span>
                      <ChevronDown className='size-4 shrink-0' aria-hidden='true' />
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className={SELECTOR_SUBMENU_CONTENT_CLASSES}>
                      <DropdownMenuLabel className='px-2 py-1.5 font-medium text-muted-foreground text-sm'>
                        {userMenuCopy.languageLabel}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={locale} onValueChange={handleLocaleChange}>
                        {locales.map((code) => (
                          <DropdownMenuRadioItem key={code} value={code}>
                            {copy.localeNames[code]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
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
                        router.push(localizeHref(locale, systemNavigation.href))
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
