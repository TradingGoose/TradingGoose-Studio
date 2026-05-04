'use client'

import * as React from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { generateWorkspaceName } from '@/lib/naming'
import { getPublicCopy } from '@/i18n/public-copy'
import { buildLocaleRequestHeaders, localizeHref, type LocaleCode } from '@/i18n/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { Workspace } from './types'
import { getWorkspaceIdFromPath, getWorkspaceSwitchPath } from './utils'

interface UseWorkspaceSwitcherOptions {
  enabled: boolean
}

export function shouldResetWorkflowRegistryOnWorkspaceSwitch(pathname: string): boolean {
  return Boolean(getWorkspaceIdFromPath(pathname))
}

export function useWorkspaceSwitcher({ enabled }: UseWorkspaceSwitcherOptions) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const locale = useLocale() as LocaleCode
  const copy = getPublicCopy(locale).workspace.switcher
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)
  const canManageWorkspaces = true
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
      const response = await fetch('/api/workspaces', {
        headers: buildLocaleRequestHeaders(locale),
      })
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
  }, [enabled, locale, workspaceId])

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

      router.push(localizeHref(locale, getWorkspaceSwitchPath(pathname, workspace.id)))
    },
    [locale, pathname, router, switchToWorkspace, workspaceId]
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
      const workspaceName = await generateWorkspaceName(locale)
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: buildLocaleRequestHeaders(locale, {
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name: workspaceName }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.error ?? copy.failedToCreateWorkspace)
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
  }, [canManageWorkspaces, copy.failedToCreateWorkspace, fetchWorkspaces, handleSwitchWorkspace, isCreatingWorkspace, locale])

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
        throw new Error(error?.error ?? copy.failedToRenameWorkspace)
      }

      await fetchWorkspaces()
      handleCancelEditing()
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : copy.failedToRenameWorkspace)
    } finally {
      setIsRenamingWorkspace(false)
    }
  }, [
    canManageWorkspaces,
    copy.failedToRenameWorkspace,
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
        throw new Error(error?.error ?? copy.failedToDeleteWorkspace)
      }

      await fetchWorkspaces()
      if (workspaceToDelete.id === activeWorkspace?.id) {
        setWorkspaceMenuOpen(false)
      }
      handleDeleteDialogChange(false)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : copy.failedToDeleteWorkspace)
    } finally {
      setIsDeletingWorkspace(false)
    }
  }, [
    canManageWorkspaces,
    copy.failedToDeleteWorkspace,
    workspaceToDelete,
    fetchWorkspaces,
    activeWorkspace?.id,
    handleDeleteDialogChange,
  ])

  return {
    canManageWorkspaces,
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
