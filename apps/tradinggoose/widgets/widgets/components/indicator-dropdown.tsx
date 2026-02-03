'use client'

import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Loader2, Search, FunctionSquare } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCustomIndicators } from '@/hooks/queries/custom-indicators'
import { isIndicatorDraft } from '@/lib/indicators/custom/compile'
import { DEFAULT_INDICATORS } from '@/lib/indicators/default'
import { cn } from '@/lib/utils'
import { useCustomIndicatorsStore } from '@/stores/custom-indicators/store'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
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
  isDraft?: boolean
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
  pairColor?: PairColor
  align?: 'start' | 'end'
  triggerClassName?: string
  menuClassName?: string
  selectionMode?: 'single' | 'multiple'
  allowDrafts?: boolean
  widgetKey?: string
}

export function IndicatorDropdown({
  workspaceId,
  value,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  pairColor,
  align = 'start',
  triggerClassName,
  menuClassName,
  selectionMode = 'single',
  allowDrafts = false,
  widgetKey,
}: IndicatorDropdownProps) {
  const [open, setOpen] = useState(false)
  const [internalValue, setInternalValue] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [hasRequestedLoad, setHasRequestedLoad] = useState(false)
  const [isLocallyLoading, setIsLocallyLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const isDataChartWidget = widgetKey === 'data_chart'
  const effectiveSelectionMode = isDataChartWidget ? 'multiple' : selectionMode
  const isMultiSelect = effectiveSelectionMode === 'multiple'

  const { isLoading: queryLoading, error: queryError, refetch, isFetching } = useCustomIndicators(
    workspaceId ?? ''
  )

  const indicators = useCustomIndicatorsStore((state) =>
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

  const defaultIndicatorOptions = useMemo<IndicatorOption[]>(() => {
    if (!isDataChartWidget) return []
    return DEFAULT_INDICATORS.map((indicator) => ({
      id: indicator.id,
      name: indicator.name,
    }))
  }, [isDataChartWidget])

  const customIndicatorOptions = useMemo<IndicatorOption[]>(
    () =>
      workspaceIndicators.map((indicator) => ({
        id: indicator.id,
        name: indicator.name || indicator.id,
        color: indicator.color,
        isDraft: isIndicatorDraft(indicator),
      })),
    [workspaceIndicators]
  )

  const indicatorOptions = useMemo(
    () => [...defaultIndicatorOptions, ...customIndicatorOptions],
    [defaultIndicatorOptions, customIndicatorOptions]
  )

  const resolvedPairColor = pairColor && pairColor !== 'gray' ? pairColor : 'gray'
  const isPairContextActive = resolvedPairColor !== 'gray'
  const pairContext = usePairColorContext(resolvedPairColor)
  const setPairContext = useSetPairColorContext()

  const isControlled = typeof value !== 'undefined'
  const selectedIndicatorIds = isControlled ? (value ?? []) : internalValue
  const selectedIndicatorSet = new Set(selectedIndicatorIds)
  const selectedIndicatorId = !isMultiSelect ? selectedIndicatorIds[0] ?? null : null
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

  const isLoading = queryLoading || isLocallyLoading
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
    setHasRequestedLoad(false)
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
    if (workspaceIndicators.length > 0 && loadError) {
      setLoadError(null)
    }
  }, [workspaceIndicators.length, loadError])

  useEffect(() => {
    if (!workspaceId || workspaceIndicators.length > 0 || hasRequestedLoad || isFetching) {
      return
    }

    let cancelled = false
    setHasRequestedLoad(true)
    setIsLocallyLoading(true)
    setLoadError(null)

    refetch()
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load indicators for indicator dropdown', error)
          setLoadError('Failed to load indicators')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLocallyLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId, workspaceIndicators.length, hasRequestedLoad, refetch, isFetching])

  useEffect(() => {
    if (isControlled || isDataChartWidget || !isPairContextActive) {
      return
    }

    const nextId = pairContext?.indicatorId ?? null
    if (!nextId) {
      return
    }

    if (!workspaceIndicators.some((indicator) => indicator.id === nextId)) {
      return
    }

    setInternalValue([nextId])
  }, [isControlled, isDataChartWidget, isPairContextActive, pairContext?.indicatorId, workspaceIndicators])

  useEffect(() => {
    if (isControlled || internalValue.length > 0 || workspaceIndicators.length === 0) {
      return
    }

    setInternalValue([workspaceIndicators[0].id])
  }, [isControlled, internalValue.length, workspaceIndicators])

  const handleSelect = (indicatorId: string) => {
    const nextId = indicatorId.trim()
    if (!nextId) {
      return
    }

    if (isMultiSelect) {
      const next = new Set(selectedIndicatorIds)
      if (next.has(nextId)) {
        next.delete(nextId)
      } else {
        next.add(nextId)
      }
      const nextIds = Array.from(next)

      if (!isControlled) {
        setInternalValue(nextIds)
      }

      onChange?.(nextIds)
      return
    }

    if (!isControlled) {
      setInternalValue([nextId])
    }

    if (!isDataChartWidget && isPairContextActive) {
      setPairContext(resolvedPairColor, {
        ...(pairContext ?? {}),
        indicatorId: nextId,
      })
    }

    onChange?.([nextId])
    setOpen(false)
  }

  const handleRetry = () => {
    if (!workspaceId) return
    setLoadError(null)
    setHasRequestedLoad(false)
  }

  const handleSearchInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return

    if (event.nativeEvent.isComposing || event.key.length === 1) {
      event.stopPropagation()
    }
  }, [])

  const filteredDefaultIndicators = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return defaultIndicatorOptions
    return defaultIndicatorOptions.filter((indicator) => {
      const label = indicator.name || indicator.id
      return (
        label.toLowerCase().includes(normalizedQuery) ||
        indicator.id.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [defaultIndicatorOptions, searchQuery])

  const filteredCustomIndicators = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return customIndicatorOptions
    return customIndicatorOptions.filter((indicator) => {
      const label = indicator.name || indicator.id
      return (
        label.toLowerCase().includes(normalizedQuery) ||
        indicator.id.toLowerCase().includes(normalizedQuery)
      )
    })
  }, [customIndicatorOptions, searchQuery])

  const renderMenuBody = () => {
    if (!workspaceId) {
      return (
        <p className='px-2 py-4 text-center text-muted-foreground text-xs'>
          Select a workspace first.
        </p>
      )
    }

    const hasIndicators = indicatorOptions.length > 0
    const hasFilteredIndicators =
      filteredDefaultIndicators.length > 0 || filteredCustomIndicators.length > 0
    if (loadError && !hasIndicators) {
      return (
        <div className='space-y-2 px-3 py-2 text-xs'>
          <p className='text-destructive'>{loadError}. Try reloading the widget.</p>
          <button
            type='button'
            className='text-primary text-xs font-semibold hover:underline'
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      )
    }

    const shouldShowLoadingState = isLoading && !hasIndicators

    if (shouldShowLoadingState) {
      return (
        <div className='flex items-center gap-2 px-3 py-2 text-muted-foreground text-xs'>
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
      <div className='flex min-w-0 w-full flex-col gap-2'>
        {loadError ? (
          <div className='space-y-1 px-2 py-1 text-xs text-destructive'>
            <p>{loadError}</p>
            <button
              type='button'
              className='text-primary text-[10px] font-semibold hover:underline'
              onClick={handleRetry}
            >
              Retry
            </button>
          </div>
        ) : null}
        {sections.map((section) => (
          <div key={section.key} className='flex min-w-0 w-full flex-col gap-1'>
            {section.label ? (
              <div className='px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground'>
                {section.label}
              </div>
            ) : null}
            {section.items.map((indicator) => {
              const indicatorKey = indicator.id.trim()
              const isSelected = selectedIndicatorSet.has(indicatorKey)
              const draft = indicator.isDraft ?? false
              const disableSelection = draft && !allowDrafts
              const itemLabel = indicator.name || indicator.id
              const indicatorColor = resolveIndicatorColor(indicator)
              return (
                <DropdownMenuItem
                  key={indicator.id}
                  className={cn(widgetHeaderMenuItemClassName, 'min-w-0 justify-between')}
                  data-active={isSelected ? '' : undefined}
                  data-indicator-id={indicator.id}
                  disabled={disableSelection}
                  onSelect={(event) => {
                    event.preventDefault()
                    if (disableSelection) return
                    if (!isMultiSelect && isSelected) return
                    handleSelect(indicator.id)
                  }}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-2'>
                    <span
                      className='h-5 w-5 p-0.5 rounded-xs'
                      style={{
                        backgroundColor: indicatorColor + '20',
                      }}
                      aria-hidden='true'
                    >
                      <FunctionSquare
                        className='h-full'
                        aria-hidden='true'
                        style={{ color: indicatorColor }}
                      />
                    </span>
                    <span className={cn(widgetHeaderMenuTextClassName, 'min-w-0 flex-1 truncate')}>
                      {itemLabel}
                    </span>
                    {draft ? (
                      <span className='rounded-sm border border-border/70 px-1 text-[10px] text-muted-foreground'>
                        Draft
                      </span>
                    ) : null}
                  </div>
                  {isSelected ? <Check className='h-3.5 w-3.5 shrink-0 text-primary' /> : null}
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </div>
    )
  }

  const chevronClassName = cn(
    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
    open && 'rotate-180'
  )

  const hasSelection = isMultiSelect ? selectedIndicatorIds.length > 0 : !!selectedIndicator
  const selectionLabel = isMultiSelect
    ? selectedIndicatorIds.length > 0
      ? `${selectedIndicatorIds.length} selected`
      : placeholder
    : selectedIndicator
      ? selectedIndicator.name || selectedIndicator.id
      : placeholder

  const colorBadge = (
    <div
      className='h-5 w-5 p-0.5 rounded-xs'
      style={{
        backgroundColor: selectedIndicatorColor + '20',
      }}
      aria-hidden='true'
    >
      <FunctionSquare className='h-4 w-4' aria-hidden='true' style={{ color: selectedIndicatorColor }} />
    </div>
  )

  const labelContent = hasSelection ? (
    <span className='min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground'>
      {selectionLabel}
    </span>
  ) : (
    <span className='min-w-0 flex-1 truncate text-left text-sm font-medium text-muted-foreground'>
      {selectionLabel}
    </span>
  )

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
                cn('flex items-center gap-2 min-w-[240px] justify-between', triggerClassName)
              )}
              aria-haspopup='listbox'
            >
              {colorBadge}
              {labelContent}
              <ChevronDown className={chevronClassName} aria-hidden='true' />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipText}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className={cn(
          widgetHeaderMenuContentClassName,
          'w-[240px] max-h-[20rem] overflow-hidden p-0 shadow-lg',
          menuClassName
        )}
        style={{ maxHeight: DROPDOWN_MAX_HEIGHT }}
        onWheel={(event) => event.stopPropagation()}
      >
        <div className='flex h-full max-h-[inherit] flex-col'>
          <div className='border-border/70 border-b p-2'>
            <div className='flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-muted-foreground text-sm'>
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
                maxHeight: `calc(${DROPDOWN_MAX_HEIGHT} - 4rem)`,
              }}
              onWheelCapture={(event) => event.stopPropagation()}
            >
              {renderMenuBody()}
            </ScrollArea>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
