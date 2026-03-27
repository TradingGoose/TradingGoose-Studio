'use client'

import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuIconClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

interface SkillCreateMenuProps {
  disabled?: boolean
  onCreateSkill?: () => void
}

export function SkillCreateMenu({ disabled = false, onCreateSkill }: SkillCreateMenuProps) {
  const handleCreateSkill = useCallback(() => {
    onCreateSkill?.()
  }, [onCreateSkill])

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={disabled}
                className={widgetHeaderIconButtonClassName()}
              >
                <Plus className='h-4 w-4' />
                <span className='sr-only'>Create skill</span>
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Create</TooltipContent>
      </Tooltip>
      <DropdownMenuContent sideOffset={6} className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
        <DropdownMenuItem className={widgetHeaderMenuItemClassName} onSelect={handleCreateSkill}>
          <Plus className={widgetHeaderMenuIconClassName} />
          <span className={widgetHeaderMenuTextClassName}>New skill</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
