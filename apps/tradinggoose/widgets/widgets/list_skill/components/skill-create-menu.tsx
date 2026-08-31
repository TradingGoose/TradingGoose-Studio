'use client'

import { type ChangeEvent, useCallback, useId, useRef } from 'react'
import { Loader2, Plus, Upload } from 'lucide-react'
import { useMessages } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'

export type SkillMenuAction = 'create' | 'import'

interface SkillCreateMenuProps {
  disabled?: boolean
  activeAction: SkillMenuAction | null
  error: string | null
  onCreateSkill?: () => void
  onImportSkills?: (file: File) => void
}

export function SkillCreateMenu({
  disabled = false,
  activeAction,
  error,
  onCreateSkill,
  onImportSkills,
}: SkillCreateMenuProps) {
  const copy = useMessages().workspace.widgets.skillList.createMenu
  const fileInputRef = useRef<HTMLInputElement>(null)
  const feedbackId = useId()
  const isPending = activeAction !== null

  const handleCreateSkill = useCallback(() => {
    onCreateSkill?.()
  }, [onCreateSkill])

  const handleImportSelection = useCallback(() => {
    if (disabled || isPending) return
    fileInputRef.current?.click()
  }, [disabled, isPending])

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) return
      onImportSkills?.(file)
      event.target.value = ''
    },
    [onImportSkills]
  )

  return (
    <div className='relative inline-flex'>
      <DropdownMenu
        onOpenChange={(_open, eventDetails) => {
          if (isPending) eventDetails.cancel()
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <span className='inline-flex'>
                <DropdownMenuTrigger
                  disabled={disabled}
                  render={
                    <button
                      type='button'
                      disabled={disabled}
                      aria-disabled={isPending || undefined}
                      aria-busy={isPending || undefined}
                      aria-describedby={isPending || error ? feedbackId : undefined}
                      className={widgetHeaderIconButtonClassName()}
                    />
                  }
                >
                  {isPending ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    <Plus className='h-4 w-4' />
                  )}
                  <span className='sr-only'>
                    {activeAction === 'create'
                      ? copy.creatingSkill
                      : activeAction === 'import'
                        ? copy.importingSkills
                        : copy.manageSkills}
                  </span>
                </DropdownMenuTrigger>
              </span>
            }
          />
          <TooltipContent side='top'>{copy.manageSkills}</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          sideOffset={6}
          className={cn(widgetHeaderMenuContentClassName, 'w-44')}
        >
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled || isPending}
            onClick={() => {
              if (disabled || isPending) return
              handleImportSelection()
            }}
          >
            <Upload className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {activeAction === 'import' ? copy.importingSkills : copy.importSkills}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className={widgetHeaderMenuItemClassName}
            disabled={disabled || isPending}
            onClick={() => {
              if (disabled || isPending) return
              handleCreateSkill()
            }}
          >
            <Plus className={widgetHeaderMenuIconClassName} />
            <span className={widgetHeaderMenuTextClassName}>
              {activeAction === 'create' ? copy.creatingSkill : copy.newSkill}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {activeAction ? (
        <p
          id={feedbackId}
          role='status'
          aria-atomic='true'
          className='absolute top-full right-0 z-50 mt-1 w-56 rounded-md border bg-popover p-2 text-popover-foreground text-xs shadow-md'
        >
          {activeAction === 'create' ? copy.creatingSkill : copy.importingSkills}
        </p>
      ) : error ? (
        <p
          id={feedbackId}
          role='alert'
          aria-atomic='true'
          className='absolute top-full right-0 z-50 mt-1 w-56 rounded-md border border-destructive/30 bg-popover p-2 text-destructive text-xs shadow-md'
        >
          {error}
        </p>
      ) : null}

      <input
        ref={fileInputRef}
        type='file'
        accept='.json,application/json'
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  )
}
