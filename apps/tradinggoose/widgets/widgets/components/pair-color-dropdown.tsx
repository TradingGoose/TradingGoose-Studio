'use client'

import { useMessages } from 'next-intl'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'
import { PAIR_COLOR_META, PAIR_COLOR_OPTIONS, type PairColor } from '@/widgets/pair-colors'

interface PairColorDropdownProps {
  color: PairColor
  onChange?: (color: PairColor) => void
}

export function PairColorDropdown({ color, onChange }: PairColorDropdownProps) {
  const copy = useMessages().workspace.widgets.pairColor
  const meta = PAIR_COLOR_META[color]
  const disabled = !onChange

  const tooltipText = disabled ? copy.selectionUnavailable : copy.selectWidgetColor

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={disabled}
                className={widgetHeaderControlClassName(
                  'mx-2 border-transparent bg-transparent p-0 hover:border-transparent hover:bg-transparent hover:opacity-70'
                )}
                aria-label={tooltipText}
                aria-haspopup='listbox'
              >
                <span className='flex items-center'>
                  <span
                    className='h-2.5 w-2.5 rounded-xxs '
                    style={{ backgroundColor: meta.hex, boxShadow: `0 0 0 4px ${meta.hex}50` }}
                    aria-hidden
                  />
                </span>
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
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
            onSelect={() => {
              if (!onChange || option.value === color) return
              onChange(option.value)
            }}
          >
            <span className='flex items-center gap-3'>
              <span
                className='h-2.5 w-2.5 rounded-xxs'
                style={{
                  backgroundColor: option.hex,
                  boxShadow: `0 0 0 4px ${option.hex}50`,
                }}
                aria-hidden
              />
              {(() => {
                const labelKey = option.value === 'gray' ? 'unlinked' : option.value
                return (
                  <span className={widgetHeaderMenuTextClassName}>
                    {copy[labelKey as keyof typeof copy] ?? option.label}
                  </span>
                )
              })()}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
