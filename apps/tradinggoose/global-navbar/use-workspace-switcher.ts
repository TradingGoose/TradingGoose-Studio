'use client'

import * as React from 'react'
import { generateWorkspaceName } from '@/lib/naming'
import { useRouter } from '@/i18n/navigation'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { Workspace } from './types'
import { getWorkspaceSwitchPath, type WorkspaceNavKey } from './utils'

interface UseWorkspaceSwitcherOptions {
  enabled: boolean
  userId: string | null
  authReady?: boolean
  workspaceId?: string
  section?: WorkspaceNavKey | null
}

export function useWorkspaceSwitcher({
  enabled,
  userId,
  authReady = true,
  workspaceId,
  section,
}: UseWorkspaceSwitcherOptions) {
  const { push } = useRouter()
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const workspaceDataKey = userId ? `${userId}:${workspaceId ?? ''}` : null
  const canUseWorkspaceData = enabled && authReady && Boolean(workspaceDataKey)
  const [workspaces, setWorkspaces] = React.useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = React.useState<Workspace | null>(null)
  const [loadedWorkspaceDataKey, setLoadedWorkspaceDataKey] = React.useState<string | null>(null)
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
  const isWorkspaceDataReady =
    canUseWorkspaceData && loadedWorkspaceDataKey === workspaceDataKey
  const canManageWorkspaces = isWorkspaceDataReady

  const clearWorkspaceState = React.useCallback((loading: boolean) => {
    setWorkspaces([])
    setActiveWorkspace(null)
    setLoadedWorkspaceDataKey(null)
    setIsWorkspacesLoading(loading)
    setIsCreatingWorkspace(false)
    setWorkspaceMenuOpen(false)
    setHoveredWorkspaceId(null)
    setEditingWorkspaceId(null)
    setEditingWorkspaceName('')
    setIsRenamingWorkspace(false)
    setRenameError(null)
    setInviteDialogOpen(false)
    setInviteWorkspace(null)
    setDeleteDialogOpen(false)
    setWorkspaceToDelete(null)
    setDeleteError(null)
    setIsDeletingWorkspace(false)
  }, [])

  const fetchWorkspaces = React.useCallback(async () => {
    if (!canUseWorkspaceData || !workspaceDataKey) {
      clearWorkspaceState(enabled)
      return
    }

    setIsWorkspacesLoading(true)
    try {
      const response = await fetch('/api/workspaces')
      if (!response.ok) {
        clearWorkspaceState(false)
        return
      }

      const data = (await response.json()) as { workspaces?: Workspace[] }
      const items = data.workspaces ?? []

      setWorkspaces(items)
      setLoadedWorkspaceDataKey(workspaceDataKey)

      const firstWorkspace = items[0] ?? null

      if (workspaceId) {
        setActiveWorkspace(
          items.find((workspace) => workspace.id === workspaceId) ?? firstWorkspace
        )
      } else {
        setActiveWorkspace((current) => current ?? firstWorkspace)
      }
    } catch (error) {
      console.error('Error fetching workspaces:', error)
      clearWorkspaceState(false)
    } finally {
      setIsWorkspacesLoading(false)
    }
  }, [canUseWorkspaceData, clearWorkspaceState, enabled, workspaceDataKey, workspaceId])

  React.useEffect(() => {
    void fetchWorkspaces()
  }, [fetchWorkspaces])

  const handleSwitchWorkspace = React.useCallback(
    async (workspace: Workspace) => {
      if (!canUseWorkspaceData) {
        return
      }

      setActiveWorkspace(workspace)
      setWorkspaceMenuOpen(false)

      if (workspaceId === workspace.id) {
        return
      }

      if (workspaceId) {
        try {
          await switchToWorkspace(workspace.id)
        } catch (error) {
          console.error('Failed to reset workflow state during workspace switch', error)
        }
      }

      push(getWorkspaceSwitchPath(workspace.id, section))
    },
    [canUseWorkspaceData, push, section, switchToWorkspace, workspaceId]
  )

  const handleCreateWorkspace = React.useCallback(async () => {
    if (!canManageWorkspaces) {
      return
    }

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

      const data = (await response.json()) as { workspace?: Workspace }
      await fetchWorkspaces()

      if (data.workspace) {
        await handleSwitchWorkspace(data.workspace)
      }
    } catch (error) {
      console.error('Error creating workspace:', error)
    } finally {
      setIsCreatingWorkspace(false)
    }
  }, [canManageWorkspaces, fetchWorkspaces, handleSwitchWorkspace, isCreatingWorkspace])

  const handleStartEditing = React.useCallback(
    (workspace: Workspace) => {
      if (!canManageWorkspaces) {
        return
      }

      if (workspace.permissions !== 'admin') {
        return
      }

      setEditingWorkspaceId(workspace.id)
      setEditingWorkspaceName(workspace.name)
      setRenameError(null)
    },
    [canManageWorkspaces]
  )

  const handleCancelEditing = React.useCallback(() => {
    setEditingWorkspaceId(null)
    setEditingWorkspaceName('')
    setRenameError(null)
    setIsRenamingWorkspace(false)
  }, [])

  const handleSaveWorkspaceName = React.useCallback(async () => {
    if (!canManageWorkspaces) {
      return
    }

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
  }, [
    canManageWorkspaces,
    editingWorkspaceId,
    editingWorkspaceName,
    fetchWorkspaces,
    handleCancelEditing,
  ])

  const handleInviteDialogChange = React.useCallback(
    (open: boolean) => {
      if (!canManageWorkspaces) {
        return
      }

      setInviteDialogOpen(open)
      if (!open) {
        setInviteWorkspace(null)
      }
    },
    [canManageWorkspaces]
  )

  const handleOpenInviteDialog = React.useCallback(
    (workspace: Workspace) => {
      if (!canManageWorkspaces) {
        return
      }

      if (workspace.permissions !== 'admin') {
        return
      }

      setInviteWorkspace(workspace)
      setInviteDialogOpen(true)
    },
    [canManageWorkspaces]
  )

  const handleDeleteDialogChange = React.useCallback(
    (open: boolean) => {
      if (!canManageWorkspaces) {
        return
      }

      if (!open) {
        setDeleteDialogOpen(false)
        setWorkspaceToDelete(null)
        setDeleteError(null)
        setIsDeletingWorkspace(false)
        return
      }

      setDeleteDialogOpen(true)
    },
    [canManageWorkspaces]
  )

  const handleConfirmDelete = React.useCallback(async () => {
    if (!canManageWorkspaces) {
      return
    }

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
  }, [
    canManageWorkspaces,
    workspaceToDelete,
    fetchWorkspaces,
    activeWorkspace?.id,
    handleDeleteDialogChange,
  ])

  return {
    canManageWorkspaces,
    activeWorkspace: isWorkspaceDataReady ? activeWorkspace : null,
    workspaces: isWorkspaceDataReady ? workspaces : [],
    isWorkspacesLoading: canUseWorkspaceData
      ? !isWorkspaceDataReady || isWorkspacesLoading
      : enabled,
    isCreatingWorkspace: canManageWorkspaces ? isCreatingWorkspace : false,
    workspaceMenuOpen: isWorkspaceDataReady ? workspaceMenuOpen : false,
    setWorkspaceMenuOpen,
    hoveredWorkspaceId: isWorkspaceDataReady ? hoveredWorkspaceId : null,
    setHoveredWorkspaceId,
    editingWorkspaceId: isWorkspaceDataReady ? editingWorkspaceId : null,
    editingWorkspaceName: isWorkspaceDataReady ? editingWorkspaceName : '',
    setEditingWorkspaceName,
    isRenamingWorkspace: isWorkspaceDataReady ? isRenamingWorkspace : false,
    renameError: isWorkspaceDataReady ? renameError : null,
    handleStartEditing,
    handleCancelEditing,
    handleSaveWorkspaceName,
    handleSwitchWorkspace,
    handleCreateWorkspace,
    inviteDialogOpen: isWorkspaceDataReady ? inviteDialogOpen : false,
    handleInviteDialogChange,
    inviteWorkspace: isWorkspaceDataReady ? inviteWorkspace : null,
    handleOpenInviteDialog,
    deleteDialogOpen: isWorkspaceDataReady ? deleteDialogOpen : false,
    handleDeleteDialogChange,
    workspaceToDelete: isWorkspaceDataReady ? workspaceToDelete : null,
    setWorkspaceToDelete,
    deleteError: isWorkspaceDataReady ? deleteError : null,
    isDeletingWorkspace: isWorkspaceDataReady ? isDeletingWorkspace : false,
    handleConfirmDelete,
  }
}
