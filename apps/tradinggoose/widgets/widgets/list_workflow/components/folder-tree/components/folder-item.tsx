'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { Folder, FolderOpen, Pencil, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { type FolderTreeNode, useFolderStore } from '@/stores/folders/store'
import { useWorkspaceId } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

const logger = createLogger('FolderItem')

interface FolderItemProps {
  folder: FolderTreeNode
  dragOver?: boolean
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  ownerId: string
}

export function FolderItem({
  folder,
  dragOver = false,
  onDragOver,
  onDragLeave,
  onDrop,
  ownerId,
}: FolderItemProps) {
  const queryClient = useQueryClient()
  const expandedFolders = useFolderStore((state) => state.expandedFolders)
  const toggleExpanded = useFolderStore((state) => state.toggleExpanded)
  const activeFolderWrite = useFolderStore((state) => state.activeWrite)
  const folderDataReady = useFolderStore(
    (state) => state.folderDataReady[folder.workspaceId] === true
  )
  const writeFolder = useFolderStore((state) => state.writeFolder)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(folder.name)
  const [isHovered, setIsHovered] = useState(false)

  const dragStartedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const workspaceId = useWorkspaceId()
  const isExpanded = expandedFolders.has(folder.id)
  const userPermissions = useUserPermissionsContext()
  const folderWritesDisabled = Boolean(activeFolderWrite) || !folderDataReady
  const isDeleting =
    activeFolderWrite?.kind === 'delete' &&
    activeFolderWrite.id === folder.id &&
    activeFolderWrite.ownerId === ownerId &&
    activeFolderWrite.workspaceId === workspaceId

  // Update editValue when folder name changes
  useEffect(() => {
    setEditValue(folder.name)
  }, [folder.name])

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleToggleExpanded = useCallback(() => {
    if (isEditing) return // Don't toggle when editing
    toggleExpanded(folder.id)
  }, [folder.id, toggleExpanded, isEditing])

  const handleDragStart = (e: React.DragEvent) => {
    const folderState = useFolderStore.getState()
    if (
      isEditing ||
      folderState.activeWrite ||
      folderState.folderDataReady[folder.workspaceId] !== true
    ) {
      e.preventDefault()
      return
    }

    dragStartedRef.current = true
    setIsDragging(true)

    e.dataTransfer.setData('folder-id', folder.id)
    e.dataTransfer.effectAllowed = 'move'

    // Set global drag state for validation in other components
    if (typeof window !== 'undefined') {
      ;(window as any).currentDragFolderId = folder.id
    }
  }

  const handleDragEnd = () => {
    setIsDragging(false)
    requestAnimationFrame(() => {
      dragStartedRef.current = false
    })

    // Clear global drag state
    if (typeof window !== 'undefined') {
      ;(window as any).currentDragFolderId = null
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    if (dragStartedRef.current || isEditing) {
      e.preventDefault()
      return
    }
    handleToggleExpanded()
  }

  const handleStartEdit = () => {
    if (folderWritesDisabled) return
    setIsEditing(true)
    setEditValue(folder.name)
  }

  const handleSaveEdit = async () => {
    if (useFolderStore.getState().activeWrite) return

    if (!editValue.trim() || editValue.trim() === folder.name) {
      setIsEditing(false)
      setEditValue(folder.name)
      return
    }

    try {
      await writeFolder(
        {
          kind: 'rename',
          workspaceId,
          ownerId,
          id: folder.id,
          name: editValue.trim(),
        },
        queryClient
      )
      logger.info(`Successfully renamed folder from "${folder.name}" to "${editValue.trim()}"`)
      setIsEditing(false)
    } catch (error) {
      logger.error('Failed to rename folder:', {
        error,
        folderId: folder.id,
        oldName: folder.name,
        newName: editValue.trim(),
      })
    }
  }

  const handleCancelEdit = () => {
    if (folderWritesDisabled) return
    setIsEditing(false)
    setEditValue(folder.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    handleSaveEdit()
  }

  const handleDelete = () => {
    if (folderWritesDisabled) return
    setShowDeleteDialog(true)
  }

  const confirmDelete = async () => {
    if (useFolderStore.getState().activeWrite) return

    try {
      await writeFolder(
        { kind: 'delete', workspaceId, ownerId, id: folder.id, name: folder.name },
        queryClient
      )
    } catch (error) {
      logger.error('Failed to delete folder:', { error })
    } finally {
      setShowDeleteDialog(false)
    }
  }

  const handleDeleteDialogOpenChange: React.ComponentProps<typeof AlertDialog>['onOpenChange'] = (
    open,
    details
  ) => {
    if (!open && useFolderStore.getState().activeWrite) {
      details.cancel()
      return
    }
    setShowDeleteDialog(open)
  }

  return (
    <>
      <div className='mb-1' onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
        <div
          className={clsx(
            'group flex h-8 w-full cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors hover:bg-card',
            isDragging ? 'opacity-50' : ''
          )}
          onClick={handleClick}
          draggable={!isEditing && !folderWritesDisabled}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className='mr-2 flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center'>
            {isExpanded ? (
              <FolderOpen className='h-[14px] w-full text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
            ) : (
              <Folder className='h-[14px] w-full text-foreground/70 group-hover:text-foreground dark:text-foreground/60' />
            )}
          </div>

          {isEditing ? (
            <input
              ref={inputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleInputBlur}
              className={clsx(
                'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                'text-muted-foreground group-hover:text-foreground'
              )}
              maxLength={50}
              disabled={folderWritesDisabled}
              onClick={(e) => e.stopPropagation()} // Prevent folder toggle when clicking input
              autoComplete='off'
              autoCorrect='off'
              autoCapitalize='off'
              spellCheck='false'
            />
          ) : (
            <span
              className={clsx(
                'min-w-0 flex-1 select-none truncate pr-1 font-medium text-sm',
                'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {folder.name}
            </span>
          )}

          {!isEditing && isHovered && userPermissions.canEdit && (
            <div
              className='flex items-center justify-center gap-1'
              onClick={(e) => e.stopPropagation()}
            >
              <Button
                variant='ghost'
                size='icon'
                className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                disabled={folderWritesDisabled}
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartEdit()
                }}
              >
                <Pencil className='!h-3.5 !w-3.5' />
                <span className='sr-only'>Rename folder</span>
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                disabled={folderWritesDisabled}
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
              >
                <Trash2 className='!h-3.5 !w-3.5' />
                <span className='sr-only'>Delete folder</span>
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={handleDeleteDialogOpenChange}>
        <AlertDialogContent hideCloseButton={folderWritesDisabled}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this folder moves its workflows and child folders up one level.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={folderWritesDisabled}>
              Cancel
            </AlertDialogCancel>
            <Button
              type='button'
              onClick={confirmDelete}
              disabled={folderWritesDisabled}
              variant='destructive'
              className='h-9 w-full rounded-sm'
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
