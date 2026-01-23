'use client'

import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

type ProviderOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

interface MarketProviderSelectorProps {
  value?: string | null
  options: ProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
}

const DEFAULT_PLACEHOLDER = 'Select provider'

export function MarketProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  align = 'start',
  triggerClassName,
  menuClassName,
}: MarketProviderSelectorProps) {
  const [open, setOpen] = useState(false)

  const selected = useMemo(
    () => options.find((option) => option.id === value),
    [options, value]
  )

  const label = selected?.name ?? placeholder
  const SelectedIcon = selected?.icon
  const isDropdownDisabled = disabled || options.length === 0
  const tooltipText = isDropdownDisabled ? 'Provider selection unavailable' : 'Select provider'

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(nextOpen) => {
        if (isDropdownDisabled) return
        setOpen(nextOpen)
      }}
      modal={false}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              disabled={isDropdownDisabled}
              className={widgetHeaderControlClassName(
                cn('flex w-7 items-center justify-center px-0', triggerClassName)
              )}
              aria-haspopup='listbox'
            >
              {SelectedIcon ? (
                <SelectedIcon className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
              ) : (
                <span className='text-xs font-semibold text-muted-foreground'>
                  {label.slice(0, 1)}
                </span>
              )}
              <span className='sr-only'>{label}</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-[220px]', menuClassName)}
      >
        {options.length === 0 ? (
          <div className='px-2 py-2 text-xs text-muted-foreground'>No providers</div>
        ) : (
          options.map((option) => {
            const isSelected = option.id === value
            const Icon = option.icon
            return (
              <DropdownMenuItem
                key={option.id}
                className={cn(widgetHeaderMenuItemClassName, 'items-center')}
                onSelect={(event) => {
                  event.preventDefault()
                  if (option.id === value) return
                  onChange?.(option.id)
                }}
              >
                {Icon ? (
                  <Icon
                    className={cn(
                      'h-4 w-4 text-muted-foreground',
                      isSelected && 'text-foreground'
                    )}
                    aria-hidden='true'
                  />
                ) : null}
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {option.name}
                </span>
                {isSelected ? <Check className='ml-auto h-3.5 w-3.5 text-primary' /> : null}
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
