'use client'

import type { ComponentType } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { selectTriggerClassName } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { cn } from '@/lib/utils'

export type ProviderSelectorVariant = 'widget' | 'form'

export type ProviderSelectorOption = {
  id: string
  name: string
  icon?: ComponentType<{ className?: string }>
}

export function providerSelectorTriggerClassName(
  variant: ProviderSelectorVariant,
  className?: string
) {
  if (variant === 'form') {
    return selectTriggerClassName(cn('group gap-2 text-left font-normal', className))
  }

  return widgetHeaderControlClassName(cn('group flex justify-between', className))
}

export function providerSelectorMenuContentClassName(
  variant: ProviderSelectorVariant,
  className?: string
) {
  return cn(
    variant === 'widget'
      ? widgetHeaderMenuContentClassName
      : 'w-[var(--anchor-width)] min-w-[var(--anchor-width)]',
    className
  )
}

export function providerSelectorMenuItemClassName(
  variant: ProviderSelectorVariant,
  className?: string
) {
  return cn(variant === 'widget' && widgetHeaderMenuItemClassName, className)
}

type ProviderSelectorProps<TOption extends ProviderSelectorOption> = {
  value?: string | null
  options: TOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder: string
  ariaLabel: string
  tooltipText: string
  selectionUnavailableText: string
  emptyText: string
  triggerClassName?: string
  menuClassName?: string
  variant?: ProviderSelectorVariant
  formatSelectedLabel?: (option: TOption, variant: ProviderSelectorVariant) => string
}

export function ProviderSelector<TOption extends ProviderSelectorOption>({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  ariaLabel,
  tooltipText,
  selectionUnavailableText,
  emptyText,
  triggerClassName,
  menuClassName,
  variant = 'widget',
  formatSelectedLabel,
}: ProviderSelectorProps<TOption>) {
  const selected = options.find((option) => option.id === value)
  const label = selected ? (formatSelectedLabel?.(selected, variant) ?? selected.name) : placeholder
  const SelectedIcon = selected?.icon
  const isDropdownDisabled = disabled || options.length === 0

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className={cn('inline-flex', variant === 'form' && 'w-full')}>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    disabled={isDropdownDisabled}
                    className={providerSelectorTriggerClassName(variant, triggerClassName)}
                    aria-haspopup='listbox'
                    aria-label={ariaLabel}
                  />
                }
              >
                <div className='flex min-w-0 items-center gap-1.5'>
                  {SelectedIcon ? (
                    <SelectedIcon
                      className='h-4 w-4 shrink-0 text-muted-foreground'
                      aria-hidden='true'
                    />
                  ) : null}
                  <span
                    className={cn(
                      'min-w-0 truncate text-left',
                      selected ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    {label}
                  </span>
                </div>
                <ChevronDown
                  className='h-4 w-4 shrink-0 text-muted-foreground opacity-50 transition-transform group-data-[popup-open]:rotate-180'
                  aria-hidden='true'
                />
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>
          {isDropdownDisabled ? selectionUnavailableText : tooltipText}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        sideOffset={6}
        className={providerSelectorMenuContentClassName(
          variant,
          cn(variant === 'widget' && 'w-[220px]', menuClassName)
        )}
      >
        {options.length === 0 ? (
          <div className='px-2 py-2 text-muted-foreground text-xs'>{emptyText}</div>
        ) : (
          options.map((option) => {
            const isSelected = option.id === value
            const Icon = option.icon
            return (
              <DropdownMenuItem
                key={option.id}
                className={providerSelectorMenuItemClassName(variant, 'items-center')}
                onClick={() => {
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
                <span
                  className={cn(variant === 'widget' && widgetHeaderMenuTextClassName, 'truncate')}
                >
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
