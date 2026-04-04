'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, ToolCase, Trash2 } from 'lucide-react'
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
import type { SkillDefinition } from '@/stores/skills/types'

interface SkillListItemProps {
  skill: SkillDefinition
  isSelected: boolean
  onSelect: (skillId: string) => void
  onDelete: (skillId: string) => Promise<void>
  onRename: (skillId: string, name: string) => Promise<void>
  canEdit: boolean
  isDeleting?: boolean
}

export function SkillListItem({
  skill,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  canEdit,
  isDeleting = false,
}: SkillListItemProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(skill.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameLabel = skill.name || 'Skill'

  useEffect(() => {
    setEditValue(skill.name)
  }, [skill.name])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleStartEdit = () => {
    if (!canEdit) return
    setIsEditing(true)
    setEditValue(skill.name)
  }

  const handleSaveEdit = async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === nameLabel) {
      setIsEditing(false)
      setEditValue(nameLabel)
      return
    }

    setIsRenaming(true)
    try {
      await onRename(skill.id, trimmed)
      setIsEditing(false)
    } catch (error) {
      console.error('Failed to rename skill', error)
      setEditValue(nameLabel)
    } finally {
      setIsRenaming(false)
    }
  }

  const handleCancelEdit = () => {
    setIsEditing(false)
    setEditValue(nameLabel)
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
    void handleSaveEdit()
  }

  const handleConfirmDelete = async () => {
    if (isDeleting) return
    try {
      await onDelete(skill.id)
      setShowDeleteDialog(false)
    } catch (error) {
      console.error('Failed to delete skill', error)
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
          maxLength={64}
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
            onSelect(skill.id)
          }}
          draggable={false}
        >
          <span
            className='flex h-5 w-5 items-center justify-center rounded-xs bg-emerald-500/15 p-0.5'
            aria-hidden='true'
          >
            <ToolCase className='h-full text-emerald-600' aria-hidden='true' />
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
            >
              <Pencil className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Rename skill</span>
            </Button>
            <Button
              variant='ghost'
              size='icon'
              onClick={() => setShowDeleteDialog(true)}
              disabled={isDeleting}
              className='h-4 w-4 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>Delete skill</span>
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
            <AlertDialogTitle>Delete skill?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this skill will permanently remove its instructions from the workspace.
              <span className='text-red-500 dark:text-red-500'> This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='flex'>
            <AlertDialogCancel className='h-9 w-full rounded-sm' disabled={isDeleting}>
              Cancel
            </AlertDialogCancel>
            <Button
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmDelete()
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
