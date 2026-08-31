'use client'

import { useEffect, useRef, useState } from 'react'
import { Pencil, ToolCase, Trash2 } from 'lucide-react'
import { useMessages } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SkillDefinition } from '@/lib/skills/types'
import { getEntityIconColor } from '@/lib/ui/icon-colors'
import { cn } from '@/lib/utils'

interface SkillListItemProps {
  skill: SkillDefinition
  isSelected: boolean
  onSelect: (skillId: string) => void
  onDelete: (skillId: string) => void
  onRename: (skillId: string, name: string) => Promise<void>
  canEdit: boolean
  canDelete?: boolean
  deleteDisabled?: boolean
}

export function SkillListItem({
  skill,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  canEdit,
  canDelete = true,
  deleteDisabled = false,
}: SkillListItemProps) {
  const copy = useMessages().workspace.widgets.skillList.listItem
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(skill.name)
  const [isRenaming, setIsRenaming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const nameLabel = skill.name || copy.untitledSkill
  const iconColor = getEntityIconColor(skill.id)

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
    <div
      className={cn(
        'group mb-1 flex h-8 cursor-pointer items-center rounded-sm px-2 py-2 font-medium font-sans text-sm transition-colors',
        isSelected ? 'bg-secondary/60' : 'hover:bg-secondary/30'
      )}
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
          className='flex h-5 w-5 items-center justify-center rounded-xs p-0.5'
          style={{ backgroundColor: `${iconColor}20` }}
          aria-hidden='true'
        >
          <ToolCase className='h-full' style={{ color: iconColor }} aria-hidden='true' />
        </span>
        {interactiveChildren}
      </button>
      {canEdit && !isEditing && (
        <div
          className='flex items-center justify-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'
          onClick={(event) => event.stopPropagation()}
        >
          <Button
            variant='ghost'
            size='icon'
            className='h-6 w-6 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
            onClick={(event) => {
              event.stopPropagation()
              handleStartEdit()
            }}
          >
            <Pencil className='!h-3.5 !w-3.5' />
            <span className='sr-only'>{copy.renameSkill}</span>
          </Button>
          {canDelete && (
            <Button
              variant='ghost'
              size='icon'
              onClick={() => onDelete(skill.id)}
              disabled={deleteDisabled}
              className='h-6 w-6 p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground disabled:opacity-50'
            >
              <Trash2 className='!h-3.5 !w-3.5' />
              <span className='sr-only'>{copy.deleteSkill}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
