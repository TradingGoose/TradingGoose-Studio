'use client'

import { type KeyboardEvent, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, FunctionSquare, Loader2, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_INDICATORS_META } from '@/lib/indicators/default'
import { cn } from '@/lib/utils'
import { useIndicators } from '@/hooks/queries/indicators'
import { useIndicatorsStore } from '@/stores/indicators/store'
import {
  widgetHeaderControlClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

const DEFAULT_PLACEHOLDER = 'Select indicators'
const FALLBACK_COLOR = '#3972F6'
const DROPDOWN_MAX_HEIGHT = '20rem'
const DROPDOWN_VIEWPORT_HEIGHT = '14rem'

type IndicatorOption = {
  id: string
  name: string
  color?: string
}

const resolveIndicatorColor = (indicator?: IndicatorOption | null): string => {
  if (!indicator) return FALLBACK_COLOR

  const directColor = indicator.color?.trim() ?? ''

  if (directColor) return directColor

  return FALLBACK_COLOR
}

interface IndicatorDropdownProps {
  workspaceId?: string | null
  value?: string[]
  onChange?: (ids: string[]) => void
  disabled?: boolean
  placeholder?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
  selectionMode?: 'single' | 'multiple'
  includeDefaults?: boolean
}

export function IndicatorDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  align = 'start',
  triggerClassName,
  menuClassName,
  selectionMode = 'multiple',
  includeDefaults = false,
}: IndicatorDropdownProps) {
  const [internalValue, setInternalValue] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const isMultiSelect = selectionMode === 'multiple'

  const {
    isLoading: queryLoading,
    error: queryError,
    refetch,
    isFetching,
  } = useIndicators(workspaceId ?? '')

  const indicators = useIndicatorsStore((state) =>
    workspaceId ? state.getAllIndicators(workspaceId) : []
  )

  const workspaceIndicators = useMemo(() => {
    if (!workspaceId) return []
    const scoped = [...indicators]
    return scoped.sort((a, b) => {
      const aTime = Date.parse(a.createdAt)
      const bTime = Date.parse(b.createdAt)
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime)
    })
  }, [indicators, workspaceId])

  const defaultIndicatorOptions = useMemo<IndicatorOption[]>(
    () =>
      includeDefaults
        ? DEFAULT_INDICATORS_META.map((indicator) => ({
          id: indicator.id,
          name: indicator.name,
        }))
        : [],
    [includeDefaults]
  )

  const customIndicatorOptions = useMemo<IndicatorOption[]>(
    () =>
      workspaceIndicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name || indicator.id,
        color: indicator.color,
      })),
    [workspaceIndicators]
  )

  const indicatorOptions = useMemo<IndicatorOption[]>(
    () => [...defaultIndicatorOptions, ...customIndicatorOptions],
    [defaultIndicatorOptions, customIndicatorOptions]
  )

  const isControlled = typeof value !== 'undefined'
  const selectedIndicatorIds = isControlled ? (value ?? []) : internalValue
  const selectedIndicatorSet = new Set(selectedIndicatorIds)
  const selectedIndicatorId = !isMultiSelect ? (selectedIndicatorIds[0] ?? null) : null
  const selectedIndicator = !isMultiSelect
    ? indicatorOptions.find((indicator) => indicator.id === selectedIndicatorId)
    : null
  const selectedIndicatorColor = useMemo(() => {
    if (isMultiSelect) {
      const firstId = selectedIndicatorIds[0]
      if (!firstId) return null
      const indicator = indicatorOptions.find((item) => item.id === firstId)
      return resolveIndicatorColor(indicator ?? null)
    }
    if (!selectedIndicator) return null
    return resolveIndicatorColor(selectedIndicator)
  }, [isMultiSelect, selectedIndicatorIds, selectedIndicator, indicatorOptions])

  const hasIndicators = indicatorOptions.length > 0
  const isLoading = queryLoading && !hasIndicators
  const isDropdownDisabled = disabled || !workspaceId

  const tooltipText = !workspaceId
    ? 'Select a workspace to choose indicators'
    : loadError
      ? 'Unable to load indicators'
      : disabled
        ? 'Indicator selection unavailable'
        : 'Select indicators'

  useEffect(() => {
    setLoadError(null)
    setSearchQuery('')
    if (!isControlled) {
      setInternalValue([])
    }
  }, [workspaceId, isControlled])

  useEffect(() => {
    if (queryError) {
      setLoadError('Failed to load indicators')
    }
  }, [queryError])

  useEffect(() => {
    if (indicatorOptions.length > 0 && loadError) {
      setLoadError(null)
    }
  }, [indicatorOptions.length, loadError])

  const filteredDefaultIndicators = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return defaultIndicatorOptions
    return defaultIndicatorOptions.filter((option) => option.name?.toLowerCase().includes(query))
  }, [defaultIndicatorOptions, searchQuery])

  const filteredCustomIndicators = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return customIndicatorOptions
    return customIndicatorOptions.filter((option) => option.name?.toLowerCase().includes(query))
  }, [customIndicatorOptions, searchQuery])

  const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      return
    }
  }

  const handleSelectionChange = (nextIds: string[]) => {
    if (isControlled) {
      onChange?.(nextIds)
    } else {
      setInternalValue(nextIds)
      onChange?.(nextIds)
    }
  }

  const handleRetry = () => {
    if (!workspaceId) return
    setLoadError(null)
    refetch().catch((error) => {
      console.error('Failed to load indicators for indicator dropdown', error)
      setLoadError('Failed to load indicators')
    })
  }

  const handleToggleIndicator = (id: string) => {
    if (isMultiSelect) {
      const next = selectedIndicatorSet.has(id)
        ? selectedIndicatorIds.filter((item) => item !== id)
        : [...selectedIndicatorIds, id]
      handleSelectionChange(next)
      return
    }
    handleSelectionChange([id])
  }

  const selectionLabel = useMemo(() => {
    if (selectedIndicatorIds.length === 0) return placeholder
    const first = indicatorOptions.find((option) => option.id === selectedIndicatorIds[0])
    if (!first) return placeholder
    if (selectedIndicatorIds.length === 1) return first.name
    return `${first.name} +${selectedIndicatorIds.length - 1}`
  }, [indicatorOptions, placeholder, selectedIndicatorIds])

  const colorBadge = (
    <div
      className='h-5 w-5 rounded-xs p-0.5'
      style={{
        backgroundColor: `${selectedIndicatorColor ?? FALLBACK_COLOR}20`,
      }}
      aria-hidden='true'
    >
      <FunctionSquare
        className='h-4 w-4'
        aria-hidden='true'
        style={{ color: selectedIndicatorColor ?? FALLBACK_COLOR }}
      />
    </div>
  )

  const labelContent =
    selectedIndicatorIds.length > 0 ? (
      <span className='min-w-0 flex-1 truncate text-left font-medium text-foreground text-sm'>
        {selectionLabel}
      </span>
    ) : (
      <span className='min-w-0 flex-1 truncate text-left font-medium text-muted-foreground text-sm'>
        {selectionLabel}
      </span>
    )

  const chevronClassName =
    'h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180'

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
                  cn(
                    'group flex min-w-[220px] items-center justify-between gap-2',
                    triggerClassName
                  )
                )}
                aria-haspopup='listbox'
              >
                {isLoading ? (
                  <Loader2 className='h-4 w-4 animate-spin text-muted-foreground' />
                ) : (
                  colorBadge
                )}
                {labelContent}
                <ChevronDown className={chevronClassName} aria-hidden='true' />
              </button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'max-h-[20rem] w-[240px] overflow-hidden p-0 shadow-lg',
          menuClassName
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
                disabled={isDropdownDisabled}
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
              {(() => {
                if (!workspaceId) {
                  return (
                    <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
                      Select a workspace first.
                    </p>
                  )
                }

                const hasFilteredIndicators =
                  filteredDefaultIndicators.length > 0 || filteredCustomIndicators.length > 0

                if (loadError && !hasIndicators) {
                  return (
                    <div className='space-y-2 px-3 py-2 text-xs'>
                      <p className='text-destructive'>{loadError}. Try reloading the widget.</p>
                      <button
                        type='button'
                        className='font-semibold text-primary text-xs hover:underline'
                        onClick={handleRetry}
                      >
                        Retry
                      </button>
                    </div>
                  )
                }

                const shouldShowLoadingState = (isLoading || isFetching) && !hasIndicators
                if (shouldShowLoadingState) {
                  return (
                    <div className='flex items-center gap-1 px-3 py-2 text-muted-foreground text-xs'>
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      Loading indicators...
                    </div>
                  )
                }

                if (!hasIndicators) {
                  return (
                    <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
                      No indicators available yet.
                    </p>
                  )
                }

                if (!hasFilteredIndicators) {
                  return (
                    <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
                      {searchQuery.trim() ? 'No indicators found.' : 'No indicators available yet.'}
                    </p>
                  )
                }

                const sections = [
                  {
                    key: 'default',
                    label: filteredDefaultIndicators.length > 0 ? 'Default indicators' : null,
                    items: filteredDefaultIndicators,
                  },
                  {
                    key: 'custom',
                    label: filteredDefaultIndicators.length > 0 ? 'Custom indicators' : null,
                    items: filteredCustomIndicators,
                  },
                ].filter((section) => section.items.length > 0)

                return (
                  <div className='flex w-full min-w-0 flex-col gap-2'>
                    {loadError ? (
                      <div className='space-y-1 px-2 py-1 text-destructive text-xs'>
                        <p>{loadError}</p>
                        <button
                          type='button'
                          className='font-semibold text-[10px] text-primary hover:underline'
                          onClick={handleRetry}
                        >
                          Retry
                        </button>
                      </div>
                    ) : null}
                    {sections.map((section) => (
                      <div key={section.key} className='flex w-full min-w-0 flex-col gap-1'>
                        {section.label ? (
                          <div className='px-2 pt-1 text-[10px] text-muted-foreground uppercase tracking-wide'>
                            {section.label}
                          </div>
                        ) : null}
                        {section.items.map((option) => {
                          const isSelected = selectedIndicatorSet.has(option.id)
                          return (
                            <DropdownMenuItem
                              key={option.id}
                              className={cn(widgetHeaderMenuItemClassName, 'items-center gap-2')}
                              onSelect={(event) => {
                                if (isMultiSelect) {
                                  event.preventDefault()
                                }
                                handleToggleIndicator(option.id)
                              }}
                            >
                              <div
                                className='h-5 w-5 rounded-xs p-0.5'
                                style={{
                                  backgroundColor: `${option.color ?? FALLBACK_COLOR}20`,
                                }}
                                aria-hidden='true'
                              >
                                <FunctionSquare
                                  className='h-4 w-4 text-muted-foreground'
                                  aria-hidden='true'
                                  style={{ color: option.color ?? FALLBACK_COLOR }}
                                />
                              </div>
                              <span className={widgetHeaderMenuTextClassName}>{option.name}</span>
                              {isSelected && <Check className='h-4 w-4 text-foreground' />}
                            </DropdownMenuItem>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </ScrollArea>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
