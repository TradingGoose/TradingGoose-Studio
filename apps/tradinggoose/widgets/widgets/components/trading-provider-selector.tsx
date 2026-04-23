'use client'

import { useMemo } from 'react'
import { Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { OAUTH_PROVIDERS, parseProvider } from '@/lib/oauth'
import { cn } from '@/lib/utils'
import { getTradingProviderDefinition } from '@/providers/trading/providers'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

type TradingProviderOption = {
  id: string
  name: string
}

export const resolveTradingProviderIcon = (providerId?: string) => {
  if (!providerId) {
    return undefined
  }

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (providerDefinition?.icon) {
    return providerDefinition.icon
  }

  const oauthProvider = providerDefinition?.oauth?.provider
  if (!oauthProvider) {
    return undefined
  }

  return OAUTH_PROVIDERS[parseProvider(oauthProvider).baseProvider]?.icon
}

type TradingProviderSelectorProps = {
  value?: string | null
  options: TradingProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
  menuClassName?: string
}

const DEFAULT_PLACEHOLDER = 'Select provider'

export function TradingProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  triggerClassName,
  menuClassName,
}: TradingProviderSelectorProps) {
  const optionsWithIcons = useMemo(
    () =>
      options.map((option) => ({
        ...option,
        icon: resolveTradingProviderIcon(option.id),
      })),
    [options]
  )
  const selectedOption = optionsWithIcons.find((option) => option.id === value) ?? null
  const label = selectedOption?.name ?? placeholder
  const SelectedIcon = selectedOption?.icon
  const isDropdownDisabled = disabled || optionsWithIcons.length === 0
  const tooltipText = isDropdownDisabled ? 'Provider selection unavailable' : 'Select provider'

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
                  cn('flex w-7 items-center justify-center px-0', triggerClassName)
                )}
                aria-haspopup='listbox'
                aria-label='Select trading provider'
              >
                {SelectedIcon ? (
                  <SelectedIcon className='h-4 w-4 text-muted-foreground' aria-hidden='true' />
                ) : (
                  <span className='font-semibold text-muted-foreground text-xs'>
                    {label.slice(0, 1)}
                  </span>
                )}
                <span className='sr-only'>{label}</span>
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
        {optionsWithIcons.length === 0 ? (
          <div className='px-2 py-2 text-muted-foreground text-xs'>No providers</div>
        ) : (
          optionsWithIcons.map((option) => {
            const Icon = option.icon
            const isSelected = option.id === value

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
