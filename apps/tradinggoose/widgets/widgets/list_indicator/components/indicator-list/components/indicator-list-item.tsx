'use client'

import { useEffect, useRef, useState } from 'react'
import { Activity, Copy, Pencil, Trash2 } from 'lucide-react'
import { useLocale, useMessages } from 'next-intl'
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
import type { EntityListMember } from '@/lib/yjs/entity-session'

interface IndicatorListItemProps {
  indicator: EntityListMember
  isSelected: boolean
  onSelect: (indicatorId: string) => void
  onCopy: (indicator: EntityListMember) => Promise<void>
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
  const locale = useLocale()
  const copy = useMessages().workspace.widgets.indicatorList.listItem
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(indicator.entityName)
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameLabel = indicator.entityName || copy.untitledIndicator
  const iconColor = getEntityIconColor(indicator.entityId, indicator.color)

  useEffect(() => {
    setEditValue(indicator.entityName)
  }, [indicator.entityName])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (!canEdit) return
    setIsEditing(true)
    setEditValue(indicator.entityName)
  }

  const handleSaveEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === indicator.entityName) {
      setIsEditing(false)
      setEditValue(indicator.entityName)
      return
    }

    setIsRenaming(true)
    try {
      await onRename(indicator.entityId, trimmed)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to rename indicator', error)
      setEditValue(indicator.entityName)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(indicator.entityName)
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
      await onDelete(indicator.entityId)
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
            onSelect(indicator.entityId)
          }}
          draggable={false}
        >
          <span
            className='flex h-5 w-5 items-center justify-center rounded-xs p-0.5'
            style={{
              backgroundColor: `${iconColor}20`,
            }}
            aria-hidden='true'
          >
            <Activity className='h-full' aria-hidden='true' style={{ color: iconColor }} />
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
              <span className='sr-only'>{copy.duplicateIndicator}</span>
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
              <span className='sr-only'>{copy.renameIndicator}</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>{copy.deleteIndicator}</span>
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
            <AlertDialogTitle>{copy.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {copy.deleteDialogDescription}{' '}
              <span className='text-red-500 dark:text-red-500'>
                {copy.deleteDialogDescriptionHighlight}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              {copy.cancel}
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
              {copy.delete}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
