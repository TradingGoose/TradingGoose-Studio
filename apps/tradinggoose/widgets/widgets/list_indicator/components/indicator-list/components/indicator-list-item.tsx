'use client'

import { useEffect, useRef, useState } from 'react'
import { Copy, Activity, Pencil, Trash2 } from 'lucide-react'
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
import { cn } from '@/lib/utils'
import type { IndicatorDefinition } from '@/stores/indicators/types'

interface IndicatorListItemProps {
  indicator: IndicatorDefinition
  isSelected: boolean
  onSelect: (indicatorId: string) => void
  onCopy: (indicator: IndicatorDefinition) => Promise<void>
  onDelete: (indicatorId: string) => Promise<void>
  onRename: (indicatorId: string, name: string) => Promise<void>
  canEdit: boolean
  isCopying: boolean
  isDeleting: boolean
}

export function IndicatorListItem({
  indicator,
  isSelected,
  onSelect,
  onCopy,
  onDelete,
  onRename,
  canEdit,
  isCopying,
  isDeleting,
}: IndicatorListItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(indicator.name ?? '')
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameLabel = indicator.name || 'Untitled indicator'

  useEffect(() => {
    setEditValue(indicator.name ?? '')
  }, [indicator.name])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (!canEdit) return
    setIsEditing(true)
    setEditValue(indicator.name ?? '')
  }

  const handleSaveEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === indicator.name) {
      setIsEditing(false)
      setEditValue(indicator.name ?? '')
      return
    }

    setIsRenaming(true)
    try {
      await onRename(indicator.id, trimmed)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to rename indicator', error)
      setEditValue(indicator.name ?? '')
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(indicator.name ?? '')
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      handleSaveEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
    }
  }

  const handleInputBlur = () => {
    handleSaveEdit()
  }

  const handleConfirmDelete = async () => {
    if (isDeleting) return
    try {
      await onDelete(indicator.id)
      setShowDeleteDialog(false)
    } catch (error) {
      console.error('Failed to delete indicator', error)
    }
  }

  const handleCopyIndicator = async () => {
    if (isCopying) return
    try {
      await onCopy(indicator)
    } catch (error) {
      console.error('Failed to copy indicator', error)
    }
  }

  const interactiveChildren = (
    <>
      {isEditing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          className={cn(
            'min-w-0 flex-1 border-0 bg-transparent p-0 font-medium font-sans text-sm outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
            isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
          )}
          maxLength={100}
          disabled={isRenaming}
          onClick={(event) => event.preventDefault()}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
        />
      ) : (
        <Tooltip delayDuration={1000}>
          <TooltipTrigger asChild>
            <span
              className={cn(
                'min-w-0 flex-1 select-none truncate pr-1 font-medium font-sans text-sm',
                isSelected ? 'text-foreground' : 'text-muted-foreground group-hover:text-foreground'
              )}
            >
              {nameLabel}
            </span>
          </TooltipTrigger>
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
            onSelect(indicator.id)
          }}
          draggable={false}
        >
          <span
            className='flex h-5 w-5 items-center justify-center rounded-xs p-0.5'
            style={{
              backgroundColor: `${indicator.color ?? '#3972F6'}20`,
            }}
            aria-hidden='true'
          >
            <Activity
              className='h-full'
              aria-hidden='true'
              style={{ color: indicator.color ?? '#3972F6' }}
            />
          </span>
          {interactiveChildren}
        </button>
        {canEdit && isHovered && !isEditing && (
          <div
            className='flex items-center justify-center gap-1'
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant='ghost'
              size='icon'
              disabled={isCopying || isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
              onClick={(event) => {
                event.stopPropagation()
                void handleCopyIndicator()
              }}
            >
              <Copy className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Duplicate indicator</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
              onClick={(event) => {
                event.stopPropagation()
                handleStartEdit()
              }}
            >
              <Pencil className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Rename indicator</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Delete indicator</span>
            </Button>
          </div>
        )}
      </div>

      <AlertDialog
        open={showDeleteDialog}
        onOpenChange={(open) => {
          if (!isDeleting) {
            setShowDeleteDialog((prev) => (prev === open ? prev : open))
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete indicator?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this indicator will permanently remove its code and configuration.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                handleConfirmDelete()
              }}
              disabled={isDeleting}
              variant='destructive'
              className='h-9 w-full rounded-sm'
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
