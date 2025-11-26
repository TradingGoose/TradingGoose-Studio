'use client'

import { useState } from 'react'
import { EllipsisVertical, SquareSplitHorizontal, SquareSplitVertical, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/shared/components/widget-header-control'

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

  const [open, setOpen] = useState(false)
  const closeMenu = () => setOpen(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={allDisabled}
          className={widgetHeaderIconButtonClassName()}
          aria-label='Widget actions'
          title='Widget actions'
          onClick={() => {
            if (!allDisabled) {
              setOpen((prev) => !prev)
            }
          }}
        >
          <EllipsisVertical className='h-3.5 w-3.5' />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-48 p-1')}
      >
        {actions.map(({ label, icon: Icon, handler }) => (
          <DropdownMenuItem
            key={label}
            className={widgetHeaderMenuItemClassName}
            disabled={!handler}
            onSelect={(event) => {
              event.preventDefault()
              if (!handler) return
              handler()
              closeMenu()
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
