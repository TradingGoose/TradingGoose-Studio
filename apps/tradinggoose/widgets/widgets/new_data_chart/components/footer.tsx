'use client'

import { type WheelEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartNetwork, Check, ClockFading } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fetchTimeZoneOptions, formatTimezoneLabel } from '@/components/timezone-selector/fetchers'
import { isUtcOffset, normalizeUtcOffset } from '@/lib/time-format'
import { cn } from '@/lib/utils'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type { MarketInterval } from '@/providers/market/types'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { DataChartWidgetParams } from '@/widgets/widgets/new_data_chart/types'
import { DEFAULT_RANGE_PRESETS, addRangeToDate } from '@/widgets/widgets/new_data_chart/series-data'
import { chooseIntervalForRange } from '@/widgets/widgets/new_data_chart/series-window'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/widgets/widgets/components/widget-header-control'

type TimeZoneOption = Awaited<ReturnType<typeof fetchTimeZoneOptions>>[number]

type DataChartTimezoneDropdownProps = {
  params: DataChartWidgetParams
  exchangeTimezone?: string | null
  panelId?: string
  widgetKey?: string
}

const DataChartTimezoneDropdown = ({
  params,
  exchangeTimezone,
  panelId,
  widgetKey,
}: DataChartTimezoneDropdownProps) => {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<TimeZoneOption[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const loadingRef = useRef(false)
  const loadRequestIdRef = useRef(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const selectedTimezone =
    typeof params.view?.timezone === 'string' ? params.view?.timezone.trim() : ''
  const selectedOption = useMemo(
    () => options.find((option) => option.name === selectedTimezone) ?? null,
    [options, selectedTimezone]
  )
  const formatUtcOffsetLabel = useCallback((value: string) => {
    const normalized = normalizeUtcOffset(value)
    return normalized === '+00:00' ? 'UTC+00:00' : `UTC${normalized}`
  }, [])
  const exchangeMeta = useMemo(() => {
    const trimmed = exchangeTimezone?.trim()
    if (!trimmed) return null
    const matched = options.find((option) => option.name === trimmed)
    if (matched) {
      return {
        dstOn: matched.dstOn,
        observesDst: matched.observesDst,
        rightLabel: matched.rightLabel,
      }
    }
    if (isUtcOffset(trimmed)) {
      return {
        dstOn: false,
        observesDst: false,
        rightLabel: formatUtcOffsetLabel(trimmed),
      }
    }
    return {
      dstOn: false,
      observesDst: false,
    }
  }, [exchangeTimezone, formatUtcOffsetLabel, options])
  const selectedLabel = selectedTimezone
    ? selectedOption?.label ?? formatTimezoneLabel(selectedTimezone)
    : 'Exchange'
  const tooltipLabel = selectedTimezone ? `Timezone: ${selectedLabel}` : 'Exchange timezone'

  const loadTimezones = useCallback(() => {
    if (loadingRef.current) return
    const requestId = loadRequestIdRef.current + 1
    loadRequestIdRef.current = requestId
    loadingRef.current = true
    setLoading(true)
    fetchTimeZoneOptions()
      .then((data) => {
        if (loadRequestIdRef.current !== requestId) return
        setOptions(data)
      })
      .catch((error) => {
        if (loadRequestIdRef.current !== requestId) return
        console.error('Failed to load timezones', error)
      })
      .finally(() => {
        if (loadRequestIdRef.current !== requestId) return
        loadingRef.current = false
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    loadTimezones()
  }, [loadTimezones])

  useEffect(() => {
    if (!open) return
    if (options.length === 0) {
      loadTimezones()
    }
  }, [open, options.length, loadTimezones])

  useEffect(() => {
    if (open) return
    setSearch('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => {
      const label = option.label.toLowerCase()
      const name = option.name.toLowerCase()
      const searchLabel = option.searchLabel?.toLowerCase() ?? ''
      return (
        label.includes(query) ||
        name.includes(query) ||
        (searchLabel ? searchLabel.includes(query) : false)
      )
    })
  }, [options, search])

  const buildStatusDotClass = (option?: { observesDst?: boolean; dstOn?: boolean }) => {
    if (!option || option.observesDst === false) return 'bg-transparent'
    if (option.dstOn === true) return 'bg-green-500/40'
    if (option.dstOn === false) return 'bg-red-500/40'
    return 'bg-transparent'
  }

  const handleTimezoneSelect = (nextTimezone: string | null) => {
    const nextView = { ...(params.view ?? {}) } as Record<string, unknown>
    if (nextTimezone) {
      nextView.timezone = nextTimezone
    } else {
      delete nextView.timezone
    }
    emitDataChartParamsChange({
      params: {
        view: nextView,
      },
      panelId,
      widgetKey,
    })
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className={widgetHeaderControlClassName('gap-1')}
              aria-haspopup='listbox'
            >
              <ClockFading className='h-3.5 w-3.5 bg-background text-muted-foreground' />
              <span className='max-w-[120px] truncate text-xs font-medium'>
                {selectedLabel || 'Exchange'}
              </span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        className={cn(widgetHeaderMenuContentClassName, 'w-[260px] p-0')}
      >
        <div className='border-b border-border p-2'>
          <Input
            ref={searchInputRef}
            placeholder='Search timezones...'
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='h-8'
          />
        </div>
        <div className='allow-scroll max-h-72 overflow-y-auto p-1' style={{ scrollbarWidth: 'thin' }}>
          {loading ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              Loading timezones...
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault()
                  handleTimezoneSelect(null)
                }}
                className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
              >
                <span
                  className={cn(
                    'mr-2 h-2.5 w-2.5 rounded-full',
                    buildStatusDotClass(exchangeMeta ?? undefined)
                  )}
                />
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>Exchange</span>
                {exchangeMeta?.rightLabel ? (
                  <span className='ml-auto text-[10px] text-muted-foreground'>
                    ({exchangeMeta.rightLabel})
                  </span>
                ) : null}
                {!selectedTimezone ? <Check className='ml-2 h-3.5 w-3.5 text-primary' /> : null}
              </DropdownMenuItem>
              {filteredOptions.length === 0 ? (
                <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
                  No timezones found.
                </DropdownMenuItem>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = option.name === selectedTimezone
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      onSelect={(event) => {
                        event.preventDefault()
                        handleTimezoneSelect(option.name)
                      }}
                      className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
                    >
                      <span
                        className={cn(
                          'mr-2 h-2.5 w-2.5 rounded-full',
                          buildStatusDotClass(option)
                        )}
                      />
                      <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                        {option.label}
                      </span>
                      {option.rightLabel ? (
                        <span className='ml-auto text-[10px] text-muted-foreground'>
                          {option.rightLabel}
                        </span>
                      ) : null}
                      {isSelected ? <Check className='ml-2 h-3.5 w-3.5 text-primary' /> : null}
                    </DropdownMenuItem>
                  )
                })
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const formatNormalizationLabel = (value: string) =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())

type DataChartNormalizationDropdownProps = {
  params: DataChartWidgetParams
  panelId?: string
  widgetKey?: string
}

const DataChartNormalizationDropdown = ({
  params,
  panelId,
  widgetKey,
}: DataChartNormalizationDropdownProps) => {
  const providerId = typeof params.data?.provider === 'string' ? params.data?.provider.trim() : ''
  const supportedModes = useMemo(() => {
    if (!providerId) return []
    const modes = getMarketSeriesCapabilities(providerId)?.normalizationModes ?? []
    return modes.length ? modes : ['raw']
  }, [providerId])
  const rawMode = useMemo(() => {
    const raw = (params.data?.providerParams as Record<string, unknown> | undefined)
      ?.normalization_mode
    return typeof raw === 'string' ? raw.trim() : ''
  }, [params.data?.providerParams])
  const fallbackMode = supportedModes[0] ?? ''
  const selectedMode = supportedModes.includes(rawMode) ? rawMode : ''
  const effectiveMode = selectedMode || fallbackMode
  const tooltipLabel = effectiveMode
    ? `Normalization: ${formatNormalizationLabel(effectiveMode)}`
    : 'Normalization unavailable'

  const handleNormalizationSelect = (nextMode: string | null) => {
    const nextProviderParams = { ...(params.data?.providerParams ?? {}) } as Record<string, unknown>
    if (nextMode) {
      nextProviderParams.normalization_mode = nextMode
    } else {
      delete nextProviderParams.normalization_mode
    }
    emitDataChartParamsChange({
      params: {
        data: {
          ...(params.data ?? {}),
          providerParams: nextProviderParams,
        },
      },
      panelId,
      widgetKey,
    })
  }

  useEffect(() => {
    if (!providerId) return
    if (!fallbackMode) return
    if (selectedMode === fallbackMode) return
    if (
      (params.data?.providerParams as Record<string, unknown> | undefined)?.normalization_mode ===
      fallbackMode
    ) {
      return
    }
    const nextProviderParams = { ...(params.data?.providerParams ?? {}) } as Record<string, unknown>
    nextProviderParams.normalization_mode = fallbackMode
    emitDataChartParamsChange({
      params: {
        data: {
          ...(params.data ?? {}),
          providerParams: nextProviderParams,
        },
      },
      panelId,
      widgetKey,
    })
  }, [fallbackMode, panelId, params.data?.providerParams, providerId, selectedMode, widgetKey])

  const isDisabled = !providerId || supportedModes.length === 0

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              disabled={isDisabled}
            >
              <ChartNetwork className='h-3.5 w-3.5' />
              <span className='sr-only'>Normalization</span>
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        className={cn(widgetHeaderMenuContentClassName, 'w-52')}
      >
        {supportedModes.length === 0 ? (
          <div className='px-2 py-2 text-xs text-muted-foreground'>
            No normalization options.
          </div>
        ) : (
          <>
            {supportedModes.map((mode) => {
              const isSelected = mode === effectiveMode
              return (
                <DropdownMenuItem
                  key={mode}
                  onSelect={(event) => {
                    event.preventDefault()
                    handleNormalizationSelect(mode)
                  }}
                  className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
                >
                  <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                    {formatNormalizationLabel(mode)}
                  </span>
                  {isSelected ? (
                    <Check className='ml-auto h-3.5 w-3.5 text-primary' />
                  ) : null}
                </DropdownMenuItem>
              )}
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export const DataChartFooter = ({
  params,
  widgetKey,
  panelId,
  allowedIntervals,
  exchangeTimezone,
}: {
  params: DataChartWidgetParams
  widgetKey?: string
  panelId?: string
  allowedIntervals: MarketInterval[]
  exchangeTimezone?: string | null
}) => {
  const availablePresets = DEFAULT_RANGE_PRESETS.filter(
    (preset) => !preset.interval || allowedIntervals.includes(preset.interval)
  )
  const storedRangeId =
    typeof params.view?.rangePresetId === 'string' ? params.view.rangePresetId.trim() : ''
  const selectedRangeId = storedRangeId
    ? availablePresets.find((preset) => preset.id === storedRangeId)?.id ?? null
    : null

  const handleRangeSelect = (presetId: string) => {
    const preset = availablePresets.find((range) => range.id === presetId)
    if (!preset) return

    const anchor = new Date(0)
    const rangeEnd = addRangeToDate(anchor, preset.range)
    const rangeMs = rangeEnd.getTime() - anchor.getTime()
    const fallbackInterval = params.data?.interval
    const presetInterval = preset.interval
    const interval =
      presetInterval ?? chooseIntervalForRange(rangeMs, allowedIntervals) ?? fallbackInterval
    const nextData = { ...(params.data ?? {}) } as Record<string, unknown>
    delete nextData.window
    delete nextData.fallbackWindow
    if (interval) {
      nextData.interval = interval
    }

    const nextView = { ...(params.view ?? {}) } as Record<string, unknown>
    nextView.rangePresetId = preset.id
    delete nextView.start
    delete nextView.end
    if (interval) {
      nextView.interval = interval
    }

    emitDataChartParamsChange({
      params: {
        data: nextData,
        view: nextView,
      },
      panelId,
      widgetKey,
    })
  }

  const footerScrollRef = useRef<HTMLDivElement>(null)
  const handleHorizontalWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (!footerScrollRef.current) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return
    }
    event.preventDefault()
    footerScrollRef.current.scrollLeft += event.deltaY
  }, [])

  return (
    <div className='border-t border-border/60 bg-background'>
      <div
        ref={footerScrollRef}
        onWheel={handleHorizontalWheel}
        className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        aria-label='Widget footer'
      >
        <div className='flex w-full flex-nowrap items-center gap-4 py-1 text-sm font-medium text-accent-foreground'>
          <div className='flex h-8 flex-grow basis-0 items-center justify-start gap-2 whitespace-nowrap text-left pl-1'>
            <div className='w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              <Tabs
                value={selectedRangeId ?? ''}
                onValueChange={handleRangeSelect}
                className='w-max'
              >
                <TabsList className='h-7 w-max justify-start gap-1 bg-muted/60 p-1'>
                  {availablePresets.map((preset) => (
                    <TabsTrigger
                      key={preset.id}
                      value={preset.id}
                      className='px-2 py-1 text-xs font-medium transition-colors data-[state=active]:shadow-sm'
                    >
                      {preset.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-2 whitespace-nowrap text-center' />
          <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-2 whitespace-nowrap text-right pr-1'>
            <DataChartTimezoneDropdown
              params={params}
              panelId={panelId}
              widgetKey={widgetKey}
              exchangeTimezone={exchangeTimezone}
            />
            <DataChartNormalizationDropdown
              params={params}
              panelId={panelId}
              widgetKey={widgetKey}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
