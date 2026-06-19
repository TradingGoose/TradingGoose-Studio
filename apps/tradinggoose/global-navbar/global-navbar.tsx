'use client'

import * as React from 'react'
import { useSelectedLayoutSegments } from 'next/navigation'
import { useTranslations } from 'next-intl'
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
import { isHosted } from '@/lib/environment'
import { getOrganizationAccessState } from '@/lib/organization/access'
import { getUserRole } from '@/lib/organization/helpers'
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
  getAdminNavState,
  getWorkspaceNavState,
} from './utils'

export function GlobalNavbar({
  children,
  isSystemAdmin = false,
  authenticatedUserId = null,
  authenticatedUserEmail = null,
  navigationMode = 'workspace',
}: {
  children: React.ReactNode
  isSystemAdmin?: boolean
  authenticatedUserId?: string | null
  authenticatedUserEmail?: string | null
  navigationMode?: 'workspace' | 'admin'
}) {
  const selectedSegments = useSelectedLayoutSegments()
  const tWorkspaceNav = useTranslations('workspace.nav')
  const brand = React.useMemo(() => getBrandConfig(), [])
  const { data: sessionData, isPending: isSessionLoading } = useSession()
  const workspaceNavState = React.useMemo(
    () => getWorkspaceNavState(selectedSegments),
    [selectedSegments]
  )
  const adminNavState = React.useMemo(() => getAdminNavState(selectedSegments), [selectedSegments])
  const workspaceId = navigationMode === 'workspace' ? workspaceNavState.workspaceId : undefined
  const activeKey =
    navigationMode === 'admin' ? adminNavState.activeKey : workspaceNavState.activeKey
  const workspaceSection = navigationMode === 'workspace' ? workspaceNavState.activeKey : null
  const workspaceNavCopy = React.useMemo(
    () => ({
      workspace: {
        dashboard: tWorkspaceNav('workspace.dashboard'),
        knowledge: tWorkspaceNav('workspace.knowledge'),
        files: tWorkspaceNav('workspace.files'),
        records: tWorkspaceNav('workspace.records'),
        monitor: tWorkspaceNav('workspace.monitor'),
      },
      more: {
        environment: tWorkspaceNav('more.environment'),
        apiKeys: tWorkspaceNav('more.apiKeys'),
        integrations: tWorkspaceNav('more.integrations'),
      },
    }),
    [tWorkspaceNav]
  )
  const adminNavCopy = React.useMemo(
    () => ({
      overview: tWorkspaceNav('admin.overview'),
      billing: tWorkspaceNav('admin.billing'),
      services: tWorkspaceNav('admin.services'),
      integrations: tWorkspaceNav('admin.integrations'),
      registration: tWorkspaceNav('admin.registration'),
    }),
    [tWorkspaceNav]
  )
  const navItems = React.useMemo(
    () =>
      navigationMode === 'admin'
        ? createAdminNav(adminNavCopy)
        : createWorkspaceNav(workspaceNavCopy, workspaceId),
    [adminNavCopy, navigationMode, workspaceId, workspaceNavCopy]
  )
  const navMain = React.useMemo<NavSection[]>(
    () => createNavSections(navItems, activeKey),
    [activeKey, navItems]
  )
  const activeNavItem = React.useMemo(() => navMain.find((item) => item.isActive), [navMain])
  const userId = authenticatedUserId ?? sessionData?.user?.id ?? null
  const userEmail = authenticatedUserEmail ?? sessionData?.user?.email ?? null
  const isAuthenticated = Boolean(userId)
  const isClientAuthReady = !isSessionLoading || Boolean(sessionData?.user?.id)
  const shouldShowSkeleton = isSessionLoading && !userId
  const { data: organizationsData } = useOrganizations({
    enabled: isAuthenticated,
  })
  const billingEnabled = organizationsData?.billingData?.data?.billingEnabled ?? true
  const activeOrganization = organizationsData?.activeOrganization
  const hasOrganization = Boolean(activeOrganization?.id)
  const userRole = getUserRole(activeOrganization, userEmail ?? undefined)
  const organizationAccess = getOrganizationAccessState({
    billingEnabled,
    hasOrganization,
    isOrganizationAdmin: userRole === 'owner' || userRole === 'admin',
    userTier: organizationsData?.billingData?.data?.tier,
  })
  const canOpenTeamSettings = organizationAccess.canOpenTeamSettings
  const [activeSettingsSection, setActiveSettingsSection] =
    React.useState<SettingsSection>('account')
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState(false)

  const userName = sessionData?.user?.name ?? brand.name
  const userMenuEmail = userEmail ?? brand.supportEmail ?? 'support@tradinggoose.ai'
  const userAvatar = sessionData?.user?.image
  const userAvatarVersion = sessionData?.user?.updatedAt
    ? new Date(sessionData.user.updatedAt).getTime()
    : null
  const workspaceSwitcher = useWorkspaceSwitcher({
    enabled: isAuthenticated,
    authReady: isClientAuthReady,
    workspaceId,
    section: workspaceSection,
  })
  const canManageWorkspaces = workspaceSwitcher.canManageWorkspaces

  const resolveSettingsSection = React.useCallback(
    (section: SettingsSection): SettingsSection => {
      if (section === 'service' && !isHosted) {
        return 'account'
      }
      if (section === 'subscription' && !billingEnabled) {
        return 'account'
      }
      if (section === 'team' && !canOpenTeamSettings) {
        return 'account'
      }
      return section
    },
    [billingEnabled, canOpenTeamSettings]
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
                activeWorkspace={workspaceSwitcher.activeWorkspace}
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
                fallbackImageUrl={brand.faviconUrl}
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
                userEmail={userMenuEmail}
                userAvatar={userAvatar}
                userAvatarVersion={userAvatarVersion}
                onOpenSettings={openSettings}
                canAccessSystemAdmin={isSystemAdmin && navigationMode !== 'admin'}
                sidebarTrigger
              />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>
          <SidebarInset className='flex h-full min-h-0 flex-1 overflow-hidden bg-background'>
            <div className='flex h-full min-h-0 flex-col bg-background'>
              <NavbarHeader
                workspaceName={workspaceSwitcher.activeWorkspace?.name}
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
            userId={userId}
            userEmail={userEmail}
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
