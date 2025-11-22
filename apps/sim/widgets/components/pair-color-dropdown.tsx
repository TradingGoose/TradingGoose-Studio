'use client'

import { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/components/widget-header-control'
import { PAIR_COLOR_META, PAIR_COLOR_OPTIONS, type PairColor } from '@/widgets/pair-colors'

interface PairColorDropdownProps {
  color: PairColor
  onChange?: (color: PairColor) => void
}

export function PairColorDropdown({ color, onChange }: PairColorDropdownProps) {
  const meta = PAIR_COLOR_META[color]
  const disabled = !onChange
  const [open, setOpen] = useState(false)
  const closeMenu = () => setOpen(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type='button'
          disabled={disabled}
          className={widgetHeaderControlClassName('border-transparent p-0 mx-2')}
          onClick={() => {
            if (!disabled) {
              setOpen((prev) => !prev)
            }
          }}
        >
          <span className='flex items-center'>
            <span
              className='h-2.5 w-2.5 rounded-xs '
              style={{ backgroundColor: meta.hex, boxShadow: `0 0 0 4px ${meta.hex}50` }}
              aria-hidden
            />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        sideOffset={6}
        avoidCollisions
        collisionPadding={12}
        className={cn(widgetHeaderMenuContentClassName, 'min-w-[180px]')}
      >
        {PAIR_COLOR_OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            className={widgetHeaderMenuItemClassName}
            disabled={!onChange || option.value === color}
            onSelect={(event) => {
              event.preventDefault()
              if (!onChange || option.value === color) return
              onChange(option.value)
              closeMenu()
            }}
          >
            <span className='flex items-center gap-3'>
              <span
                className='h-2.5 w-2.5 rounded-xs'
                style={{
                  backgroundColor: option.hex,
                  boxShadow: `0 0 0 4px ${option.hex}50`,
                }}
                aria-hidden
              />
              <span className={widgetHeaderMenuTextClassName}>{option.label}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
