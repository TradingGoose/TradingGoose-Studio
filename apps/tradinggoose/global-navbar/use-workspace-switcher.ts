'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { generateWorkspaceName } from '@/lib/naming'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { Workspace } from './types'
import { getWorkspaceIdFromPath, getWorkspaceSwitchPath } from './utils'

interface UseWorkspaceSwitcherOptions {
  enabled: boolean
  readOnly?: boolean
}

export function shouldResetWorkflowRegistryOnWorkspaceSwitch(pathname: string): boolean {
  return Boolean(getWorkspaceIdFromPath(pathname))
}

export function useWorkspaceSwitcher({ enabled, readOnly = false }: UseWorkspaceSwitcherOptions) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const workspaceId = React.useMemo(() => getWorkspaceIdFromPath(pathname), [pathname])
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = React.useState<Workspace | null>(null)
  const [isWorkspacesLoading, setIsWorkspacesLoading] = React.useState(enabled)
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

  const fetchWorkspaces = React.useCallback(async () => {
    if (!enabled) {
      setWorkspaces([])
      setActiveWorkspace(null)
      setIsWorkspacesLoading(false)
      return
    }

    setIsWorkspacesLoading(true)
    try {
      const response = await fetch(readOnly ? '/api/workspaces?autoCreate=false' : '/api/workspaces')
      if (!response.ok) {
        setWorkspaces([])
        setActiveWorkspace(null)
        return
      }

      const data = await response.json()
      const items = ((data.workspaces ?? []) as Workspace[]).map((workspace) => ({
        ...workspace,
        permissions: workspace.permissions ?? 'admin',
        role: workspace.role ?? (workspace.permissions === 'admin' ? 'owner' : 'member'),
      }))

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
  }, [enabled, readOnly, workspaceId])

  React.useEffect(() => {
    void fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSwitchWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      setActiveWorkspace(workspace)
      setWorkspaceMenuOpen(false)

      if (workspaceId === workspace.id) {
        return
      }

      if (shouldResetWorkflowRegistryOnWorkspaceSwitch(pathname)) {
        try {
          await switchToWorkspace(workspace.id)
        } catch (error) {
          console.error('Failed to reset workflow state during workspace switch', error)
        }
      }

      router.push(getWorkspaceSwitchPath(pathname, workspace.id))
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
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? 'Failed to create workspace')
      }

      const data = await response.json()
      await fetchWorkspaces()

      if (data.workspace) {
        await handleSwitchWorkspace({
          ...data.workspace,
          permissions: data.workspace.permissions ?? 'admin',
          role: data.workspace.role ?? 'owner',
        } satisfies Workspace)
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
      return
    }

    setDeleteDialogOpen(true)
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

  return {
    activeWorkspace,
    workspaces,
    isWorkspacesLoading,
    isCreatingWorkspace,
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    hoveredWorkspaceId,
    setHoveredWorkspaceId,
    editingWorkspaceId,
    editingWorkspaceName,
    setEditingWorkspaceName,
    isRenamingWorkspace,
    renameError,
    handleStartEditing,
    handleCancelEditing,
    handleSaveWorkspaceName,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    inviteDialogOpen,
    handleInviteDialogChange,
    inviteWorkspace,
    handleOpenInviteDialog,
    deleteDialogOpen,
    handleDeleteDialogChange,
    workspaceToDelete,
    setWorkspaceToDelete,
    deleteError,
    isDeletingWorkspace,
    handleConfirmDelete,
  }
}
