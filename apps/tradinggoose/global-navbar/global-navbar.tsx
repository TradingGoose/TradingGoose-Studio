'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
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
import { isBillingEnabled } from '@/lib/environment'
import { generateWorkspaceName } from '@/lib/naming'
import { useOrganizations } from '@/hooks/queries/organization'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { NavbarHeader } from './components/navbar-header'
import { SidebarNav, SidebarUsageIndicator } from './components/sidebar-nav'
import { UserMenu } from './components/user-menu'
import { WorkspaceDialogs } from './components/workspace-dialogs'
import { WorkspaceSwitcher } from './components/workspace-switcher'
import { GlobalNavbarHeaderProvider } from './header-context'
import { SettingsDialog } from './settings-modal/settings-dialog'
import type { SettingsSection } from './settings-modal/types'
import type { NavSection, Workspace } from './types'
import {
  createNavSections,
  createWorkspaceNav,
  getWorkspaceIdFromPath,
  getWorkspaceSwitchPath,
} from './utils'

const AUTH_ROUTE_PREFIXES = ['/login', '/signup', '/reset-password', '/verify', '/sso'] as const
const LANDING_ROUTE_PREFIXES = ['/privacy', '/terms', '/careers', '/blog'] as const

export function GlobalNavbar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const brand = React.useMemo(() => getBrandConfig(), [])
  const { data: sessionData, isPending: isSessionLoading } = useSession()
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const workspaceId = React.useMemo(() => getWorkspaceIdFromPath(pathname), [pathname])
  const workspaceNavItems = React.useMemo(() => createWorkspaceNav(workspaceId), [workspaceId])
  const navMain = React.useMemo<NavSection[]>(
    () => createNavSections(pathname, workspaceNavItems),
    [pathname, workspaceNavItems]
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
  const billingEnabled = isBillingEnabled
  const hasOrganization = Boolean(organizationsData?.activeOrganization?.id)
  const canManageTeam = billingEnabled && hasOrganization
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = React.useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = React.useState(true)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = React.useState(false)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [hoveredWorkspaceId, setHoveredWorkspaceId] = React.useState<string | null>(null)
  const [editingWorkspaceId, setEditingWorkspaceId] = React.useState<string | null>(null)
  const [editingWorkspaceName, setEditingWorkspaceName] = React.useState('')
  const [isRenamingWorkspace, setIsRenamingWorkspace] = React.useState(false)
  const [renameError, setRenameError] = React.useState<string | null>(null)
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false)
  const [inviteWorkspace, setInviteWorkspace] = React.useState<Workspace | null>(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [workspaceToDelete, setWorkspaceToDelete] = React.useState<Workspace | null>(null)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
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
          case 'copilot':
          case 'apikeys':
          case 'credentials':
          case 'files':
            return 'copilot'
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

  const createDefaultWorkspace = React.useCallback(async () => {
    try {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Workspace' }),
      })

      if (!response.ok) {
        throw new Error('Failed to create default workspace')
      }

      const data = await response.json()
      const newWorkspace = data.workspace as Workspace | undefined

      if (!newWorkspace) {
        throw new Error('Workspace payload missing from response')
      }

      const normalizedWorkspace: Workspace = {
        ...newWorkspace,
        permissions: newWorkspace.permissions ?? 'admin',
        role: newWorkspace.role ?? 'owner',
      }

      return normalizedWorkspace
    } catch (error) {
      console.error('Error creating default workspace:', error)
      return null
    }
  }, [])

  const fetchWorkspaces = React.useCallback(async () => {
    if (!shouldRenderNavbar || isSessionLoading) {
      return
    }

    if (!isAuthenticated) {
      setWorkspaces([])
      setActiveWorkspace(null)
      setIsWorkspacesLoading(false)
      return
    }

    setIsWorkspacesLoading(true)
    try {
      const response = await fetch('/api/workspaces')
      if (!response.ok) {
        setWorkspaces([])
        setActiveWorkspace(null)
        return
      }
      const data = await response.json()
      let items = (data.workspaces ?? []) as Workspace[]

      if (items.length === 0) {
        const createdWorkspace = await createDefaultWorkspace()
        if (createdWorkspace) {
          items = [createdWorkspace]
        }
      }

      setWorkspaces(items)

      if (workspaceId) {
        const match = items.find((workspace) => workspace.id === workspaceId)
        setActiveWorkspace(match ?? items[0] ?? null)
      } else {
        setActiveWorkspace((current) => current ?? items[0] ?? null)
      }
    } catch (error) {
      console.error('Error fetching workspaces:', error)
      setWorkspaces([])
      setActiveWorkspace(null)
    } finally {
      setIsWorkspacesLoading(false)
    }
  }, [workspaceId, isAuthenticated, isSessionLoading, createDefaultWorkspace, shouldRenderNavbar])

  React.useEffect(() => {
    if (!shouldRenderNavbar) {
      return
    }
    fetchWorkspaces()
  }, [fetchWorkspaces, shouldRenderNavbar])

  const handleSwitchWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      setActiveWorkspace(workspace)
      setWorkspaceMenuOpen(false)
      if (workspaceId !== workspace.id) {
        try {
          await switchToWorkspace(workspace.id)
        } catch (error) {
          console.error('Failed to reset workflow state during workspace switch', error)
        }
        const targetPath = getWorkspaceSwitchPath(pathname, workspace.id)
        // Client navigation only; avoid full page reload
        router.push(targetPath)
      }
    },
    [pathname, router, switchToWorkspace, workspaceId]
  )

  const handleCreateWorkspace = React.useCallback(async () => {
    if (isCreatingWorkspace) {
      return
    }
    setIsCreatingWorkspace(true)
    try {
      const workspaceName = await generateWorkspaceName()
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: workspaceName }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create workspace')
      }
      const data = await response.json()
      await fetchWorkspaces()
      if (data.workspace) {
        await handleSwitchWorkspace(data.workspace)
      }
    } catch (error) {
      console.error('Error creating workspace:', error)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [fetchWorkspaces, handleSwitchWorkspace, isCreatingWorkspace])

  const handleStartEditing = React.useCallback((workspace: Workspace) => {
    if (workspace.permissions !== 'admin') {
      return
    }
    setEditingWorkspaceId(workspace.id)
    setEditingWorkspaceName(workspace.name)
    setRenameError(null)
  }, [])

  const handleCancelEditing = React.useCallback(() => {
    setEditingWorkspaceId(null)
    setEditingWorkspaceName('')
    setRenameError(null)
    setIsRenamingWorkspace(false)
  }, [])

  const handleSaveWorkspaceName = React.useCallback(async () => {
    if (!editingWorkspaceId) {
      return
    }
    const newName = editingWorkspaceName.trim()
    if (!newName) {
      handleCancelEditing()
      return
    }
    setIsRenamingWorkspace(true)
    try {
      const response = await fetch(`/api/workspaces/${editingWorkspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? 'Failed to rename workspace')
      }
      await fetchWorkspaces()
      handleCancelEditing()
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : 'Failed to rename workspace')
    } finally {
      setIsRenamingWorkspace(false)
    }
  }, [editingWorkspaceId, editingWorkspaceName, fetchWorkspaces, handleCancelEditing])

  const handleInviteDialogChange = React.useCallback((open: boolean) => {
    setInviteDialogOpen(open)
    if (!open) {
      setInviteWorkspace(null)
    }
  }, [])

  const handleOpenInviteDialog = React.useCallback((workspace: Workspace) => {
    if (workspace.permissions !== 'admin') {
      return
    }
    setInviteWorkspace(workspace)
    setInviteDialogOpen(true)
  }, [])

  const handleDeleteDialogChange = React.useCallback((open: boolean) => {
    if (!open) {
      setDeleteDialogOpen(false)
      setWorkspaceToDelete(null)
      setDeleteError(null)
      setIsDeletingWorkspace(false)
    } else {
      setDeleteDialogOpen(true)
    }
  }, [])

  const handleConfirmDelete = React.useCallback(async () => {
    if (!workspaceToDelete) {
      return
    }
    setIsDeletingWorkspace(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceToDelete.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? 'Failed to delete workspace')
      }
      await fetchWorkspaces()
      if (workspaceToDelete.id === activeWorkspace?.id) {
        setWorkspaceMenuOpen(false)
      }
      handleDeleteDialogChange(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete workspace')
    } finally {
      setIsDeletingWorkspace(false)
    }
  }, [workspaceToDelete, fetchWorkspaces, activeWorkspace?.id, handleDeleteDialogChange])

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
                activeWorkspace={activeWorkspace}
                workspaces={workspaces}
                isLoading={isWorkspacesLoading}
                workspaceMenuOpen={workspaceMenuOpen}
                onWorkspaceMenuOpenChange={setWorkspaceMenuOpen}
                hoveredWorkspaceId={hoveredWorkspaceId}
                onHoverWorkspace={setHoveredWorkspaceId}
                editingWorkspaceId={editingWorkspaceId}
                editingWorkspaceName={editingWorkspaceName}
                onEditingWorkspaceNameChange={setEditingWorkspaceName}
                isRenamingWorkspace={isRenamingWorkspace}
                renameError={renameError}
                onStartEditing={handleStartEditing}
                onCancelEditing={handleCancelEditing}
                onSaveWorkspaceName={handleSaveWorkspaceName}
                onSwitchWorkspace={handleSwitchWorkspace}
                onInviteWorkspace={handleOpenInviteDialog}
                onCreateWorkspace={handleCreateWorkspace}
                isCreatingWorkspace={isCreatingWorkspace}
                onDeleteWorkspace={(workspace) => {
                  setWorkspaceToDelete(workspace)
                  handleDeleteDialogChange(true)
                }}
                brandName={brand.name}
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
              />
            </SidebarFooter>
            <SidebarRail />
          </Sidebar>
          <SidebarInset className='flex h-full min-h-0 flex-1 overflow-hidden bg-background'>
            <div className='flex h-full min-h-0 flex-col bg-background'>
              <NavbarHeader
                workspaceName={activeWorkspace?.name}
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

        <WorkspaceDialogs
          inviteDialogOpen={inviteDialogOpen}
          onInviteDialogChange={handleInviteDialogChange}
          inviteWorkspace={inviteWorkspace}
          deleteDialogOpen={deleteDialogOpen}
          onDeleteDialogChange={handleDeleteDialogChange}
          workspaceToDelete={workspaceToDelete}
          deleteError={deleteError}
          isDeletingWorkspace={isDeletingWorkspace}
          onConfirmDelete={() => void handleConfirmDelete()}
        />
        <SettingsDialog
          open={isSettingsModalOpen}
          section={activeSettingsSection}
          onOpenChange={setIsSettingsModalOpen}
        />
      </div>
    </GlobalNavbarHeaderProvider>
  )
}
