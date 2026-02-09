'use client'

import { useCallback, useState } from 'react'
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

interface IndicatorCreateMenuProps {
  disabled?: boolean
  onCreateIndicator?: () => void
}

export function IndicatorCreateMenu({
  disabled = false,
  onCreateIndicator,
}: IndicatorCreateMenuProps) {
  const [open, setOpen] = useState(false)

  const handleCreateIndicator = useCallback(() => {
    onCreateIndicator?.()
    setOpen(false)
  }, [onCreateIndicator])

  const isMenuDisabled = disabled

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              disabled={isMenuDisabled}
              className={widgetHeaderIconButtonClassName()}
            >
              <Plus className='h-4 w-4' />
              <span className='sr-only'>Create indicator</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>Create</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-44')}
      >
        <DropdownMenuItem
          className={widgetHeaderMenuItemClassName}
          onSelect={(event) => {
            event.preventDefault()
            handleCreateIndicator()
          }}
        >
          <Plus className={widgetHeaderMenuIconClassName} />
          <span className={widgetHeaderMenuTextClassName}>New indicator</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
