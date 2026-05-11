'use client'

import type { ComponentType } from 'react'
import { useMemo } from 'react'
import { Check, ChevronDown } from 'lucide-react'
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

export type MarketProviderOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

interface MarketProviderSelectorProps {
  value?: string | null
  options: MarketProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
  menuClassName?: string
}

const DEFAULT_PLACEHOLDER = 'Select Market Provider'

export function MarketProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  triggerClassName,
  menuClassName,
}: MarketProviderSelectorProps) {
  const selected = useMemo(() => options.find((option) => option.id === value), [options, value])

  const label = selected ? `Market: ${selected.name}` : placeholder
  const SelectedIcon = selected?.icon
  const isDropdownDisabled = disabled || options.length === 0
  const tooltipText = isDropdownDisabled
    ? 'Provider selection unavailable'
    : 'Select market data provider'

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                disabled={isDropdownDisabled}
                className={widgetHeaderControlClassName(
                  cn('group flex justify-between', triggerClassName)
                )}
                aria-haspopup='listbox'
                aria-label='Select market provider'
              >
                <span className='flex min-w-0 items-center gap-1.5'>
                  {SelectedIcon ? (
                    <SelectedIcon
                      className='h-4 w-4 shrink-0 text-muted-foreground'
                      aria-hidden='true'
                    />
                  ) : null}
                  <span
                    className={cn(
                      'min-w-0 text-left',
                      selected ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {label}
                  </span>
                </span>
                <ChevronDown
                  className='h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                  aria-hidden='true'
                />
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={cn(widgetHeaderMenuContentClassName, 'w-[220px]', menuClassName)}
      >
        {options.length === 0 ? (
          <div className='px-2 py-2 text-muted-foreground text-xs'>No providers</div>
        ) : (
          options.map((option) => {
            const isSelected = option.id === value
            const Icon = option.icon
            return (
              <DropdownMenuItem
                key={option.id}
                className={cn(widgetHeaderMenuItemClassName, 'items-center')}
                onSelect={() => {
                  if (option.id === value) return
                  onChange?.(option.id)
                }}
              >
                {Icon ? (
                  <Icon
                    className={cn('h-4 w-4 text-muted-foreground', isSelected && 'text-foreground')}
                    aria-hidden='true'
                  />
                ) : null}
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>{option.name}</span>
                {isSelected ? <Check className='ml-auto h-3.5 w-3.5 text-primary' /> : null}
              </DropdownMenuItem>
            )
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
