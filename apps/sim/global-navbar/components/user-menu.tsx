'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import {
  BadgeCheck,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Monitor,
  Moon,
  Sparkles,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { signOut } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { getEnv, isTruthy } from '@/lib/env'
import { getInitials } from '../utils'
import { clearUserData } from '@/stores'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useSubscriptionStore } from '@/stores/subscription/store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './resizable-dropdown'

const LazyUsageIndicator = dynamic(
  () =>
    import(
      '@/app/workspace/[workspaceId]/w/components/sidebar/components/usage-indicator/usage-indicator'
    ).then((mod) => mod.UsageIndicator),
  { ssr: false }
)

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

interface UserMenuProps {
  userName: string
  userEmail: string
  userAvatar?: string | null
  onOpenAccountSettings?: () => void
  onOpenSubscriptionSettings?: () => void
}

export function UserMenu({
  userName,
  userEmail,
  userAvatar,
  onOpenAccountSettings,
  onOpenSubscriptionSettings,
}: UserMenuProps) {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const logger = createLogger('UserMenu')
  const theme = useGeneralStore((state) => state.theme)
  const setTheme = useGeneralStore((state) => state.setTheme)
  const isGeneralLoading = useGeneralStore((state) => state.isLoading)
  const isThemeLoading = useGeneralStore((state) => state.isThemeLoading)
  const currentThemeLabel =
    THEME_OPTIONS.find((option) => option.value === theme)?.label ?? 'Theme'
  const billingEnabled = useMemo(() => {
    const runtimeFlag = getEnv('NEXT_PUBLIC_BILLING_ENABLED')
    const buildFlag = process.env.NEXT_PUBLIC_BILLING_ENABLED ?? process.env.BILLING_ENABLED
    return isTruthy(runtimeFlag ?? buildFlag)
  }, [])

  useEffect(() => {
    if (!billingEnabled) return
    void useSubscriptionStore.getState().loadData()
  }, [billingEnabled])

  const handleUsageIndicatorClick = () => {
    if (!billingEnabled) return

    const subscriptionStore = useSubscriptionStore.getState()
    const isBlocked = subscriptionStore.getBillingStatus() === 'blocked'
    const canUpgrade = subscriptionStore.canUpgrade()

    if (isBlocked || !canUpgrade) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('open-settings', { detail: { tab: 'subscription' } })
        )
      }
      return
    }

    if (onOpenSubscriptionSettings) {
      onOpenSubscriptionSettings()
    } else if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-settings', { detail: { tab: 'subscription' } }))
    }
  }

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

  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
              <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                variant='muted'
                size='lg'
                className='data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground'
              >
                <Avatar className='h-8 w-8 rounded-lg'>
                  {userAvatar ? <AvatarImage src={userAvatar} alt={userName} /> : null}
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
              {billingEnabled ? (
                <div className='px-1 py-1.5'>
                  <LazyUsageIndicator onClick={handleUsageIndicatorClick} />
                </div>
              ) : null}

              <DropdownMenuGroup>
                <div className='flex items-center gap-1.5 px-2 pb-1.5 pt-0.5'>
                  <DropdownMenuItem className='flex items-center gap-2 text-sm font-medium text-muted-foreground'>
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
                    if (onOpenAccountSettings) {
                      onOpenAccountSettings()
                    } else if (typeof window !== 'undefined') {
                      window.dispatchEvent(
                        new CustomEvent('open-settings', { detail: { tab: 'account' } })
                      )
                    }
                  }}
                >
                  <BadgeCheck />
                  Account Detail
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <CreditCard />
                  Billing
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isSigningOut}
                onSelect={(event) => {
                  event.preventDefault()
                  void handleSignOut()
                }}
              >
                <LogOut />
                {isSigningOut ? 'Logging out…' : 'Log out'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      {billingEnabled ? (
        null
      ) : null}
    </>
  )
}
