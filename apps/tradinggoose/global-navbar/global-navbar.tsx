'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { getBrandConfig } from '@/lib/branding/branding'
import { useOrganizations } from '@/hooks/queries/organization'
import { NavbarHeader } from './components/navbar-header'
import { SidebarNav, SidebarUsageIndicator } from './components/sidebar-nav'
import { UserMenu } from './components/user-menu'
import { WorkspaceDialogs } from './components/workspace-dialogs'
import { WorkspaceSwitcher } from './components/workspace-switcher'
import { GlobalNavbarHeaderProvider } from './header-context'
import { SettingsDialog } from './settings-modal/settings-dialog'
import type { SettingsSection } from './settings-modal/types'
import type { NavSection } from './types'
import { useWorkspaceSwitcher } from './use-workspace-switcher'
import {
  createAdminNav,
  createNavSections,
  createWorkspaceNav,
  getWorkspaceIdFromPath,
} from './utils'

const AUTH_ROUTE_PREFIXES = ['/login', '/signup', '/reset-password', '/verify', '/sso'] as const
const LANDING_ROUTE_PREFIXES = ['/privacy', '/terms', '/careers', '/blog'] as const

export function GlobalNavbar({
  children,
  isSystemAdmin = false,
  navigationMode = 'workspace',
}: {
  children: React.ReactNode
  isSystemAdmin?: boolean
  navigationMode?: 'workspace' | 'admin'
}) {
  const pathname = usePathname() ?? '/'
  const brand = React.useMemo(() => getBrandConfig(), [])
  const { data: sessionData, isPending: isSessionLoading } = useSession()
  const workspaceId = React.useMemo(() => getWorkspaceIdFromPath(pathname), [pathname])
  const navItems = React.useMemo(
    () => (navigationMode === 'admin' ? createAdminNav() : createWorkspaceNav(workspaceId)),
    [navigationMode, workspaceId]
  )
  const navMain = React.useMemo<NavSection[]>(
    () => createNavSections(pathname, navItems),
    [pathname, navItems]
  )
  const activeNavItem = React.useMemo(() => navMain.find((item) => item.isActive), [navMain])
  const isAuthenticated = Boolean(sessionData?.user?.id)
  const isAuthRoute = React.useMemo(
    () => AUTH_ROUTE_PREFIXES.some((route) => pathname.startsWith(route)),
    [pathname]
  )
  const isLandingRoute = React.useMemo(
    () => pathname === '/' || LANDING_ROUTE_PREFIXES.some((route) => pathname.startsWith(route)),
    [pathname]
  )
  const isSidebarRoute = React.useMemo(() => navMain.some((item) => item.isActive), [navMain])
  const shouldRenderNavbar = isSidebarRoute && !isLandingRoute && !isAuthRoute
  const shouldShowSkeleton = shouldRenderNavbar && isSessionLoading
  const { data: organizationsData } = useOrganizations({
    enabled: shouldRenderNavbar && isAuthenticated && !isSessionLoading,
  })
  const billingEnabled = organizationsData?.billingData?.data?.billingEnabled ?? true
  const hasOrganization = Boolean(organizationsData?.activeOrganization?.id)
  const canManageTeam = billingEnabled && hasOrganization
  const [activeSettingsSection, setActiveSettingsSection] =
    React.useState<SettingsSection>('account')
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState(false)
  const [userNameOverride, setUserNameOverride] = React.useState<string | null>(null)
  const [userAvatarOverride, setUserAvatarOverride] = React.useState<{
    url: string | null
    version: number | string | null
  }>({ url: null, version: null })

  const userId = sessionData?.user?.id ?? null
  const userName = userNameOverride ?? sessionData?.user?.name ?? brand.name
  const userEmail = sessionData?.user?.email ?? brand.supportEmail ?? 'support@tradinggoose.ai'
  const userAvatar = userAvatarOverride.url ?? sessionData?.user?.image ?? brand.logoUrl
  const userAvatarVersion =
    userAvatarOverride.version ??
    (sessionData?.user?.updatedAt ? new Date(sessionData.user.updatedAt).getTime() : null)
  const workspaceSwitcher = useWorkspaceSwitcher({
    enabled: shouldRenderNavbar && isAuthenticated && !isSessionLoading,
    readOnly: navigationMode === 'admin',
  })
  const canManageWorkspaces = workspaceSwitcher.canManageWorkspaces
  const workspaceSwitcherActiveWorkspace =
    navigationMode === 'admin' ? null : workspaceSwitcher.activeWorkspace
  const systemNavigation = React.useMemo(() => {
    if (!isSystemAdmin || navigationMode === 'admin') {
      return null
    }

    return {
      href: '/admin',
      label: 'System Admin',
    }
  }, [isSystemAdmin, navigationMode])

  const resolveSettingsSection = React.useCallback(
    (section: SettingsSection): SettingsSection => {
      if (section === 'subscription' && !billingEnabled) {
        return 'account'
      }
      if (section === 'team' && !canManageTeam) {
        return 'account'
      }
      return section
    },
    [billingEnabled, canManageTeam]
  )

  const openSettings = React.useCallback(
    (section: SettingsSection) => {
      setActiveSettingsSection(resolveSettingsSection(section))
      setIsSettingsModalOpen(true)
    },
    [resolveSettingsSection]
  )

  React.useEffect(() => {
    setActiveSettingsSection((current) => resolveSettingsSection(current))
  }, [resolveSettingsSection])

  React.useEffect(() => {
    const handleOpenSettings = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: string } | undefined>
      const tab = customEvent.detail?.tab ?? 'account'

      const section: SettingsSection = (() => {
        switch (tab) {
          case 'service':
            return 'service'
          case 'team':
            return 'team'
          case 'subscription':
            return 'subscription'
          case 'sso':
            return 'sso'
          default:
            return 'account'
        }
      })()

      openSettings(section)
    }

    window.addEventListener('open-settings', handleOpenSettings as EventListener)
    return () => {
      window.removeEventListener('open-settings', handleOpenSettings as EventListener)
    }
  }, [openSettings])

  React.useEffect(() => {
    if (!userId || typeof window === 'undefined') {
      setUserNameOverride(null)
      return
    }

    const key = `user-name-${userId}`

    const readStoredName = () => {
      const storedName = window.localStorage.getItem(key)
      setUserNameOverride(storedName !== null ? storedName || null : null)
    }

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key !== key) return
      readStoredName()
    }

    const handleNameEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ name?: string | null }>
      const detail = customEvent.detail
      setUserNameOverride(detail && 'name' in detail ? (detail?.name ?? null) : null)
    }

    readStoredName()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('user-name-updated', handleNameEvent)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('user-name-updated', handleNameEvent)
    }
  }, [userId])

  React.useEffect(() => {
    if (!userId || typeof window === 'undefined') return

    const readStoredAvatar = () => {
      const storedVersion = window.localStorage.getItem(`user-avatar-version-${userId}`)
      const storedUrl = window.localStorage.getItem(`user-avatar-url-${userId}`)
      if (storedVersion || storedUrl !== null) {
        setUserAvatarOverride((prev) => ({
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

    const handleAvatarEvent = (event: Event) => {
      const customEvent = event as CustomEvent<{ url?: string | null; version?: number }>
      const detail = customEvent.detail
      setUserAvatarOverride((prev) => ({
        url: detail && 'url' in detail ? (detail?.url ?? null) : prev.url,
        version:
          detail && 'version' in detail
            ? (detail?.version ?? prev.version ?? Date.now())
            : (prev.version ?? Date.now()),
      }))
    }

    readStoredAvatar()
    window.addEventListener('storage', handleStorage)
    window.addEventListener('user-avatar-updated', handleAvatarEvent)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('user-avatar-updated', handleAvatarEvent)
    }
  }, [userId])

  if (!shouldRenderNavbar) {
    return <GlobalNavbarHeaderProvider>{children}</GlobalNavbarHeaderProvider>
  }

  if (shouldShowSkeleton) {
    return (
      <GlobalNavbarHeaderProvider>
        <div className='flex h-screen w-screen max-w-[100vw] overflow-hidden bg-background'>
          <SidebarProvider defaultOpen className='flex h-full min-h-0 w-full overflow-hidden'>
            <Sidebar collapsible='icon'>
              <SidebarHeader className='p-4'>
                <div className='space-y-2'>
                  <Skeleton className='h-6 w-3/4' />
                  <Skeleton className='h-4 w-1/2' />
                </div>
              </SidebarHeader>
              <SidebarContent className='space-y-2 p-4'>
                {[...Array(5)].map((_, index) => (
                  <Skeleton key={index} className='h-9 w-full rounded-sm' />
                ))}
              </SidebarContent>
              <SidebarFooter className=''>
                <div className='flex items-center gap-2'>
                  <Skeleton className='h-8 w-8 rounded-full' />
                  <div className='space-y-1 group-data-[state=collapsed]:hidden'>
                    <Skeleton className='h-4 w-24' />
                    <Skeleton className='h-3 w-16' />
                  </div>
                </div>
              </SidebarFooter>
              <SidebarRail />
            </Sidebar>
            <SidebarInset className='flex h-full min-h-0 flex-1 overflow-hidden bg-background'>
              <div className='flex h-full min-h-0 flex-col bg-background'>
                <div className='border-b px-6 py-4'>
                  <Skeleton className='h-6 w-64' />
                </div>
                <div className='min-h-0 flex-1 overflow-hidden p-6'>
                  <div className='space-y-3'>
                    <Skeleton className='h-4 w-1/3' />
                    <Skeleton className='h-4 w-1/4' />
                    <Skeleton className='h-4 w-1/2' />
                  </div>
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </div>
      </GlobalNavbarHeaderProvider>
    )
  }

  if (!isAuthenticated) {
    return <GlobalNavbarHeaderProvider>{children}</GlobalNavbarHeaderProvider>
  }

  return (
    <GlobalNavbarHeaderProvider>
      <div className='flex h-screen w-screen max-w-[100vw] overflow-hidden bg-background'>
        <SidebarProvider defaultOpen className='flex h-full min-h-0 w-full overflow-hidden'>
          <Sidebar collapsible='icon'>
            <SidebarHeader>
              <WorkspaceSwitcher
                activeWorkspace={workspaceSwitcherActiveWorkspace}
                workspaces={workspaceSwitcher.workspaces}
                isLoading={workspaceSwitcher.isWorkspacesLoading}
                canManageWorkspaces={canManageWorkspaces}
                workspaceMenuOpen={workspaceSwitcher.workspaceMenuOpen}
                onWorkspaceMenuOpenChange={workspaceSwitcher.setWorkspaceMenuOpen}
                hoveredWorkspaceId={workspaceSwitcher.hoveredWorkspaceId}
                onHoverWorkspace={workspaceSwitcher.setHoveredWorkspaceId}
                editingWorkspaceId={workspaceSwitcher.editingWorkspaceId}
                editingWorkspaceName={workspaceSwitcher.editingWorkspaceName}
                onEditingWorkspaceNameChange={workspaceSwitcher.setEditingWorkspaceName}
                isRenamingWorkspace={workspaceSwitcher.isRenamingWorkspace}
                renameError={workspaceSwitcher.renameError}
                onStartEditing={workspaceSwitcher.handleStartEditing}
                onCancelEditing={workspaceSwitcher.handleCancelEditing}
                onSaveWorkspaceName={workspaceSwitcher.handleSaveWorkspaceName}
                onSwitchWorkspace={workspaceSwitcher.handleSwitchWorkspace}
                onInviteWorkspace={workspaceSwitcher.handleOpenInviteDialog}
                onCreateWorkspace={workspaceSwitcher.handleCreateWorkspace}
                isCreatingWorkspace={workspaceSwitcher.isCreatingWorkspace}
                onDeleteWorkspace={(workspace) => {
                  workspaceSwitcher.setWorkspaceToDelete(workspace)
                  workspaceSwitcher.handleDeleteDialogChange(true)
                }}
                brandName={brand.name}
                fallbackSubtitle={navigationMode === 'admin' ? 'admin' : 'Workspace'}
                fallbackImageUrl={brand.logoUrl ?? brand.faviconUrl ?? '/favicon/favicon.ico'}
              />
            </SidebarHeader>
            <SidebarContent>
              <SidebarNav navItems={navMain} />
            </SidebarContent>
            <SidebarFooter className='flex flex-col gap-2 px-2 py-3'>
              <SidebarUsageIndicator
                onOpenSubscriptionSettings={() => openSettings('subscription')}
              />
              <UserMenu
                userId={userId}
                userName={userName}
                userEmail={userEmail}
                userAvatar={userAvatar}
                userAvatarVersion={userAvatarVersion}
                onOpenSettings={openSettings}
                canManageTeam={canManageTeam}
                systemNavigation={systemNavigation}
              />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>
          <SidebarInset className='flex h-full min-h-0 flex-1 overflow-hidden bg-background'>
            <div className='flex h-full min-h-0 flex-col bg-background'>
              <NavbarHeader
                workspaceName={workspaceSwitcherActiveWorkspace?.name}
                brandName={brand.name}
                pageTitle={activeNavItem?.title}
                pageIcon={activeNavItem?.icon}
              />
              <div className='min-h-0 flex-1 overflow-hidden p-1'>
                <div className='h-full w-full overflow-auto'>{children}</div>
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>

        {canManageWorkspaces ? (
          <WorkspaceDialogs
            inviteDialogOpen={workspaceSwitcher.inviteDialogOpen}
            onInviteDialogChange={workspaceSwitcher.handleInviteDialogChange}
            inviteWorkspace={workspaceSwitcher.inviteWorkspace}
            deleteDialogOpen={workspaceSwitcher.deleteDialogOpen}
            onDeleteDialogChange={workspaceSwitcher.handleDeleteDialogChange}
            workspaceToDelete={workspaceSwitcher.workspaceToDelete}
            deleteError={workspaceSwitcher.deleteError}
            isDeletingWorkspace={workspaceSwitcher.isDeletingWorkspace}
            onConfirmDelete={() => void workspaceSwitcher.handleConfirmDelete()}
          />
        ) : null}
        <SettingsDialog
          open={isSettingsModalOpen}
          section={activeSettingsSection}
          onOpenChange={setIsSettingsModalOpen}
        />
      </div>
    </GlobalNavbarHeaderProvider>
  )
}
