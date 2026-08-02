'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Pencil, Trash2, Wrench } from 'lucide-react'
import { useMessages } from 'next-intl'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'
import type { CustomToolDefinition } from '@/stores/custom-tools/types'

interface CustomToolListItemProps {
  tool: CustomToolDefinition
  isSelected: boolean
  onSelect: (customToolId: string) => void
  onDelete: (customToolId: string) => Promise<boolean>
  onRename: (customToolId: string, title: string) => Promise<boolean>
  canEdit: boolean
  canDelete?: boolean
  writesDisabled?: boolean
  isDeleting?: boolean
  isRenaming?: boolean
}

const getCustomToolTitle = (tool: CustomToolDefinition) => tool.title.trim()

export function CustomToolListItem({
  tool,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  canEdit,
  canDelete = true,
  writesDisabled = false,
  isDeleting = false,
  isRenaming = false,
}: CustomToolListItemProps) {
  const copy = useMessages().workspace.widgets.customToolList.listItem
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(getCustomToolTitle(tool))
  const [renameFailed, setRenameFailed] = useState(false)
  const [deleteFailed, setDeleteFailed] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameFailureId = useId()
  const nameLabel = getCustomToolTitle(tool)
  const iconColor = getEntityIconColor(tool.id)

  useEffect(() => {
    setEditValue(getCustomToolTitle(tool))
  }, [tool.title])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (!canEdit || writesDisabled) return
    setRenameFailed(false)
    setIsEditing(true)
    setEditValue(getCustomToolTitle(tool))
  }

  const handleSaveEdit = async () => {
    if (isRenaming || writesDisabled) return
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === nameLabel) {
      setIsEditing(false)
      setEditValue(nameLabel)
      setRenameFailed(false)
      return
    }

    setRenameFailed(false)
    try {
      if (await onRename(tool.id, trimmed)) {
        setIsEditing(false)
      }
    } catch {
      setRenameFailed(true)
      inputRef.current?.focus()
    }
  }

  const handleCancelEdit = () => {
    if (isRenaming) return
    setIsEditing(false)
    setEditValue(nameLabel)
    setRenameFailed(false)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleSaveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    if (isRenaming) return
    void handleSaveEdit()
  }

  const handleConfirmDelete = async () => {
    if (isDeleting || writesDisabled || !canDelete) return
    setDeleteFailed(false)
    try {
      if (await onDelete(tool.id)) {
        setShowDeleteDialog(false)
      }
    } catch {
      setDeleteFailed(true)
    }
  }

  const interactiveChildren = (
    <>
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(event) => {
            setEditValue(event.target.value)
            setRenameFailed(false)
          }}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          aria-invalid={renameFailed || undefined}
          aria-describedby={renameFailed ? renameFailureId : undefined}
          className={cn(
            'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
          )}
          maxLength={100}
          disabled={isRenaming || writesDisabled}
          onClick={(event) => event.preventDefault()}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                className={cn(
                  'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
                  isSelected
                    ? 'text-foreground'
                    : 'text-muted-foreground group-hover:text-foreground'
                )}
              >
                {nameLabel}
              </span>
            }
            delay={1000}
          />
          <TooltipContent side='top' align='start' sideOffset={10}>
            <p>{nameLabel}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  )

  return (
    <div className='mb-1'>
      <div
        className={cn(
          'group flex h-8 cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors',
          isSelected ? 'bg-secondary/60' : 'hover:bg-secondary/30'
        )}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left'
          disabled={isEditing}
          onClick={(event) => {
            if (isEditing) {
              event.preventDefault()
              return
            }
            onSelect(tool.id)
          }}
          draggable={false}
        >
          <span
            className='flex h-5 w-5 items-center justify-center rounded-xs p-0.5'
            style={{ backgroundColor: `${iconColor}20` }}
            aria-hidden='true'
          >
            <Wrench className='h-full' style={{ color: iconColor }} aria-hidden='true' />
          </span>
          {interactiveChildren}
        </button>
        {canEdit && isHovered && !isEditing && (
          <div
            className='flex items-center justify-center gap-1'
            onClick={(event) => event.stopPropagation()}
          >
            <Button
              variant='ghost'
              size='icon'
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
              onClick={(event) => {
                event.stopPropagation()
                handleStartEdit()
              }}
              disabled={writesDisabled}
            >
              <Pencil className='!h-3.5 !w-3.5' />
              <span className='sr-only'>{copy.renameCustomTool}</span>
            </Button>
            {canDelete && (
              <Button
                variant='ghost'
                size='icon'
                onClick={() => {
                  setDeleteFailed(false)
                  setShowDeleteDialog(true)
                }}
                disabled={writesDisabled}
                className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
              >
                <Trash2 className='!h-3.5 !w-3.5' />
                <span className='sr-only'>{copy.deleteCustomTool}</span>
              </Button>
            )}
          </div>
        )}
      </div>
      {isEditing && isRenaming ? (
        <p className='px-2 text-muted-foreground text-xs' role='status'>
          {copy.renaming}
        </p>
      ) : null}
      {isEditing && renameFailed ? (
        <p id={renameFailureId} className='px-2 text-destructive text-xs' role='alert'>
          {copy.renameFailed}
        </p>
      ) : null}

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open, details) => {
          if (!open && isDeleting) return details.cancel()
          setShowDeleteDialog((prev) => (prev === open ? prev : open))
          if (!open) setDeleteFailed(false)
        }}
      >
        <AlertDialogContent hideCloseButton={isDeleting}>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDialogDescription}{' '}
              <span className='text-red-500 dark:text-red-500'>
                {copy.deleteDialogDescriptionHighlight}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteFailed ? (
            <p className='text-destructive text-sm' role='alert'>
              {copy.deleteFailed}
            </p>
          ) : null}
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              {copy.cancel}
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
              }}
              disabled={isDeleting}
              aria-busy={isDeleting ? 'true' : undefined}
              variant='destructive'
              className='h-9 w-full rounded-sm'
            >
              {isDeleting ? copy.deleting : copy.delete}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
