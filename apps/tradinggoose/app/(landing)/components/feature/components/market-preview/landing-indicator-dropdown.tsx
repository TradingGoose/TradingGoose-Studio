'use client'

import { type KeyboardEvent, useMemo, useState } from 'react'
import { Activity, Check, ChevronDown, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'
import type { LandingMarketIndicatorOption } from './indicators/catalog'

const DEFAULT_PLACEHOLDER = 'Select indicators'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

type LandingIndicatorDropdownProps = {
  value: string[]
  options: LandingMarketIndicatorOption[]
  onChange: (ids: string[]) => void
  placeholder?: string
  align?: 'start' | 'end'
}

export function LandingIndicatorDropdown({
  value,
  options,
  onChange,
  placeholder = DEFAULT_PLACEHOLDER,
  align = 'end',
}: LandingIndicatorDropdownProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const selectedIndicatorSet = new Set(value)

  const filteredOptions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.name.toLowerCase().includes(query))
  }, [options, searchQuery])

  const selectedIndicatorColor = useMemo(() => {
    const firstId = value[0]
    if (!firstId) return options[0]?.color ?? '#3972F6'
    return options.find((option) => option.id === firstId)?.color ?? '#3972F6'
  }, [options, value])

  const selectionLabel = useMemo(() => {
    if (value.length === 0) return placeholder
    const first = options.find((option) => option.id === value[0])
    if (!first) return placeholder
    if (value.length === 1) return first.name
    return `${first.name} +${value.length - 1}`
  }, [options, placeholder, value])

  const colorBadge = (
    <div
      className='h-5 w-5 rounded-xs p-0.5'
      style={{
        backgroundColor: `${selectedIndicatorColor}20`,
      }}
      aria-hidden='true'
    >
      <Activity className='h-4 w-4' style={{ color: selectedIndicatorColor }} />
    </div>
  )

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      return
    }
  }

  const handleToggleIndicator = (id: string) => {
    const next = selectedIndicatorSet.has(id) ? value.filter((item) => item !== id) : [...value, id]
    onChange(next)
  }

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='inline-flex'>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className={widgetHeaderControlClassName(
                  'group flex min-w-[220px] items-center justify-between gap-2'
                )}
                aria-haspopup='listbox'
              >
                {colorBadge}
                {value.length > 0 ? (
                  <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
                    {selectionLabel}
                  </span>
                ) : (
                  <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
                    {selectionLabel}
                  </span>
                )}
                <ChevronDown
                  className='h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'
                  aria-hidden='true'
                />
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>Select indicators</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'max-h-[20rem] w-[240px] overflow-hidden p-0 shadow-lg'
        )}
        style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex h-full max-h-[inherit] flex-col'>
          <div className='border-border/70 border-b p-2'>
            <div className='flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
              <Search className='h-3.5 w-3.5 shrink-0' />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder='Search indicators...'
                className='h-6 border-0 bg-transparent px-0 text-foreground text-xs placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
                onKeyDown={handleSearchInputKeyDown}
                autoComplete='off'
                autoCorrect='off'
                spellCheck='false'
              />
            </div>
          </div>
          <div className='h-full min-h-0 flex-1 overflow-hidden'>
            <ScrollArea
              className={cn(
                'h-full w-full px-2 py-2',
                '[&_[data-radix-scroll-area-viewport]>div]:!block',
                '[&_[data-radix-scroll-area-viewport]>div]:w-full',
                '[&_[data-radix-scroll-area-viewport]>div]:max-w-full',
                '[&_[data-radix-scroll-area-viewport]>div]:overflow-hidden'
              )}
              style={{
                height: DROPDOWN_VIEWPORT_HEIGHT,
              }}
            >
              {filteredOptions.length === 0 ? (
                <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
                  {searchQuery.trim() ? 'No indicators found.' : 'No indicators available yet.'}
                </p>
              ) : (
                <div className='flex w-full min-w-0 flex-col gap-1'>
                  {filteredOptions.map((option) => {
                    const isSelected = selectedIndicatorSet.has(option.id)
                    return (
                      <DropdownMenuItem
                        key={option.id}
                        className={cn(widgetHeaderMenuItemClassName, 'items-center gap-2')}
                        onSelect={(event) => {
                          event.preventDefault()
                          handleToggleIndicator(option.id)
                        }}
                      >
                        <div
                          className='h-5 w-5 rounded-xs p-0.5'
                          style={{
                            backgroundColor: `${option.color}20`,
                          }}
                          aria-hidden='true'
                        >
                          <Activity className='h-4 w-4' style={{ color: option.color }} />
                        </div>
                        <span
                          className={cn(widgetHeaderMenuTextClassName, 'min-w-0 flex-1 truncate')}
                        >
                          {option.name}
                        </span>
                        {isSelected ? <Check className='h-4 w-4 text-foreground' /> : null}
                      </DropdownMenuItem>
                    )
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
