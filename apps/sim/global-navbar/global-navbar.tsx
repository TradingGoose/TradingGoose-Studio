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
import { useSession } from '@/lib/auth-client'
import { getBrandConfig } from '@/lib/branding/branding'
import { generateWorkspaceName } from '@/lib/naming'
import { NavbarHeader } from './components/navbar-header'
import { SidebarNav } from './components/sidebar-nav'
import { UserMenu } from './components/user-menu'
import { WorkspaceDialogs } from './components/workspace-dialogs'
import { WorkspaceSwitcher } from './components/workspace-switcher'
import { GlobalNavbarHeaderProvider } from './header-context'
import type { NavSection, Workspace } from './types'
import { createNavSections, createWorkspaceNav, getWorkspaceIdFromPath } from './utils'

export function GlobalNavbar({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const brand = React.useMemo(() => getBrandConfig(), [])
  const { data: sessionData } = useSession()
  const workspaceId = React.useMemo(() => getWorkspaceIdFromPath(pathname), [pathname])
  const workspaceNavItems = React.useMemo(() => createWorkspaceNav(workspaceId), [workspaceId])
  const navMain = React.useMemo<NavSection[]>(
    () => createNavSections(pathname, workspaceNavItems),
    [pathname, workspaceNavItems]
  )
  const activeNavItem = React.useMemo(() => navMain.find((item) => item.isActive), [navMain])
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
  const [inviteEmail, setInviteEmail] = React.useState('')
  const [invitePermission, setInvitePermission] = React.useState<'read' | 'write' | 'admin'>('read')
  const [inviteError, setInviteError] = React.useState<string | null>(null)
  const [isInviting, setIsInviting] = React.useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [workspaceToDelete, setWorkspaceToDelete] = React.useState<Workspace | null>(null)
  const [isDeletingWorkspace, setIsDeletingWorkspace] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const userName = sessionData?.user?.name ?? brand.name
  const userEmail = sessionData?.user?.email ?? brand.supportEmail ?? 'help@sim.ai'
  const userAvatar = sessionData?.user?.image ?? brand.logoUrl

  const fetchWorkspaces = React.useCallback(async () => {
    setIsWorkspacesLoading(true)
    try {
      const response = await fetch('/api/workspaces')
      if (!response.ok) {
        throw new Error('Failed to fetch workspaces')
      }
      const data = await response.json()
      const items = (data.workspaces ?? []) as Workspace[]
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
  }, [workspaceId])

  React.useEffect(() => {
    fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSwitchWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      setActiveWorkspace(workspace)
      setWorkspaceMenuOpen(false)
      if (workspaceId !== workspace.id) {
        router.push(`/workspace/${workspace.id}/dashboard`)
      }
    },
    [router, workspaceId]
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
    if (!open) {
      setInviteDialogOpen(false)
      setInviteWorkspace(null)
      setInviteEmail('')
      setInvitePermission('read')
      setInviteError(null)
      setIsInviting(false)
    } else {
      setInviteDialogOpen(true)
    }
  }, [])

  const handleOpenInviteDialog = React.useCallback((workspace: Workspace) => {
    if (workspace.permissions !== 'admin') {
      return
    }
    setInviteWorkspace(workspace)
    setInviteDialogOpen(true)
  }, [])

  const handleSendInvite = React.useCallback(async () => {
    if (!inviteWorkspace || !inviteEmail.trim()) {
      setInviteError('Email is required')
      return
    }
    setIsInviting(true)
    setInviteError(null)
    try {
      const response = await fetch('/api/workspaces/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: inviteWorkspace.id,
          email: inviteEmail.trim(),
          permission: invitePermission,
          role: 'member',
        }),
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? 'Failed to send invitation')
      }
      handleInviteDialogChange(false)
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : 'Failed to send invitation')
    } finally {
      setIsInviting(false)
    }
  }, [inviteWorkspace, inviteEmail, invitePermission, handleInviteDialogChange])

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
            <SidebarFooter>
              <UserMenu userName={userName} userEmail={userEmail} userAvatar={userAvatar} />
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
              <div className='min-h-0 flex-1 overflow-hidden p-1.5'>
                <div className='h-full w-full overflow-auto'>{children}</div>
              </div>
            </div>
          </SidebarInset>
        </SidebarProvider>

        <WorkspaceDialogs
          inviteDialogOpen={inviteDialogOpen}
          onInviteDialogChange={handleInviteDialogChange}
          inviteWorkspace={inviteWorkspace}
          inviteEmail={inviteEmail}
          onInviteEmailChange={setInviteEmail}
          invitePermission={invitePermission}
          onInvitePermissionChange={setInvitePermission}
          inviteError={inviteError}
          isInviting={isInviting}
          onSendInvite={() => void handleSendInvite()}
          deleteDialogOpen={deleteDialogOpen}
          onDeleteDialogChange={handleDeleteDialogChange}
          workspaceToDelete={workspaceToDelete}
          deleteError={deleteError}
          isDeletingWorkspace={isDeletingWorkspace}
          onConfirmDelete={() => void handleConfirmDelete()}
        />
      </div>
    </GlobalNavbarHeaderProvider>
  )
}
