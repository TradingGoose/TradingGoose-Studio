'use client'

import { EllipsisVertical, SquareSplitHorizontal, SquareSplitVertical, X } from 'lucide-react'
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
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'

interface WidgetActionMenuProps {
  onSplitVertical?: () => void
  onSplitHorizontal?: () => void
  onClose?: () => void
  disabled?: boolean
}

export function WidgetActionMenu({
  onSplitVertical,
  onSplitHorizontal,
  onClose,
  disabled,
}: WidgetActionMenuProps) {
  const actions = [
    {
      label: 'Split vertically',
      icon: SquareSplitVertical,
      handler: onSplitVertical,
    },
    {
      label: 'Split horizontally',
      icon: SquareSplitHorizontal,
      handler: onSplitHorizontal,
    },
    {
      label: 'Close widget',
      icon: X,
      handler: onClose,
    },
  ]

  const allDisabled = actions.every((action) => !action.handler) || disabled

  const tooltipText = allDisabled ? 'Actions unavailable' : 'Widget actions'

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    disabled={allDisabled}
                    className={widgetHeaderIconButtonClassName()}
                    aria-label='Widget actions'
                  />
                }
              >
                <EllipsisVertical className='h-3.5 w-3.5' />
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-48 p-1')}
      >
        {actions.map(({ label, icon: Icon, handler }) => (
          <DropdownMenuItem
            key={label}
            className={widgetHeaderMenuItemClassName}
            disabled={!handler}
            onClick={() => {
              if (!handler) return
              handler()
            }}
          >
            <Icon className={widgetHeaderMenuTextClassName} aria-hidden='true' />
            <span className={widgetHeaderMenuTextClassName}>{label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
