'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react'
import { ChartNetwork, Check, Clock, ClockFading, ClockPlus } from 'lucide-react'
import { fetchTimeZoneOptions, formatTimezoneLabel } from '@/components/timezone-selector/fetchers'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  widgetHeaderControlClassName,
  widgetHeaderIconButtonClassName,
  widgetHeaderMenuContentClassName,
  widgetHeaderMenuItemClassName,
  widgetHeaderMenuTextClassName,
} from '@/components/widget-header-control'
import { isUtcOffset, normalizeUtcOffset } from '@/lib/time-format'
import { cn } from '@/lib/utils'
import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type { MarketInterval } from '@/providers/market/types'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/contract'
import {
  formatDataChartIntervalLabel,
  formatDataChartNormalizationTooltip,
  formatDataChartRangeIntervalTooltip,
  formatDataChartRangeLabel,
  formatDataChartTimezoneTooltip,
  getDataChartNormalizationLabel,
  getDataChartRangePresetLabel,
  useDataChartCopy,
} from '@/widgets/widgets/data_chart/copy'
import { useDataChartParamsPatch } from '@/widgets/widgets/data_chart/hooks/use-data-chart-params-patch'
import { addRangeToDate, DEFAULT_RANGE_PRESETS } from '@/widgets/widgets/data_chart/series-data'
import { chooseIntervalForRange } from '@/widgets/widgets/data_chart/series-window'

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
  const copy = useDataChartCopy()
  const patchWidgetParams = useDataChartParamsPatch()
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
  const formatUtcOffsetLabel = useCallback(
    (value: string) => {
      const normalized = normalizeUtcOffset(value)
      return normalized === '+00:00'
        ? `${copy.footer.timezone.utc}+00:00`
        : `${copy.footer.timezone.utc}${normalized}`
    },
    [copy.footer.timezone.utc]
  )
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
    ? (selectedOption?.label ?? formatTimezoneLabel(selectedTimezone))
    : copy.footer.timezone.exchange
  const tooltipLabel = selectedTimezone
    ? formatDataChartTimezoneTooltip(copy, selectedLabel)
    : copy.footer.timezone.tooltipFallback

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

  const handleTimezoneMenuOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (nextOpen) {
        if (options.length === 0) {
          loadTimezones()
        }
        return
      }

      setSearch('')
    },
    [options.length, loadTimezones]
  )

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
      nextView.timezone = undefined
    }
    patchWidgetParams({
      view: nextView,
    })
  }

  return (
    <DropdownMenu onOpenChange={handleTimezoneMenuOpenChange} modal={false}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    className={widgetHeaderControlClassName('gap-1')}
                    aria-haspopup='listbox'
                  />
                }
              >
                <ClockFading className='h-3.5 w-3.5 bg-background text-muted-foreground' />
                <span className='max-w-[120px] truncate font-medium text-xs'>
                  {selectedLabel || copy.footer.timezone.exchange}
                </span>
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align='end'
        className={cn(widgetHeaderMenuContentClassName, 'w-[260px] p-0')}
        finalFocus={false}
      >
        <div className='border-border border-b p-2'>
          <Input
            ref={searchInputRef}
            placeholder={copy.footer.timezone.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className='h-8'
          />
        </div>
        <div
          className='allow-scroll max-h-72 overflow-y-auto p-1'
          style={{ scrollbarWidth: 'thin' }}
        >
          {loading ? (
            <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
              {copy.footer.timezone.loading}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                onClick={() => handleTimezoneSelect(null)}
                className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
              >
                <span
                  className={cn(
                    'mr-2 h-2.5 w-2.5 rounded-full',
                    buildStatusDotClass(exchangeMeta ?? undefined)
                  )}
                />
                <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                  {copy.footer.timezone.exchange}
                </span>
                {exchangeMeta?.rightLabel ? (
                  <span className='ml-auto text-[10px] text-muted-foreground'>
                    ({exchangeMeta.rightLabel})
                  </span>
                ) : null}
                {!selectedTimezone ? <Check className='ml-2 h-3.5 w-3.5 text-primary' /> : null}
              </DropdownMenuItem>
              {filteredOptions.length === 0 ? (
                <DropdownMenuItem disabled className='justify-center text-muted-foreground'>
                  {copy.footer.timezone.noResults}
                </DropdownMenuItem>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = option.name === selectedTimezone
                  return (
                    <DropdownMenuItem
                      key={option.id}
                      onClick={() => handleTimezoneSelect(option.name)}
                      className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
                    >
                      <span
                        className={cn('mr-2 h-2.5 w-2.5 rounded-full', buildStatusDotClass(option))}
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

type DataChartNormalizationDropdownProps = {
  params: DataChartWidgetParams
  panelId?: string
  widgetKey?: string
}

type DataChartMarketSessionDropdownProps = {
  params: DataChartWidgetParams
  panelId?: string
  widgetKey?: string
}

const DataChartMarketSessionDropdown = ({
  params,
  panelId,
  widgetKey,
}: DataChartMarketSessionDropdownProps) => {
  const copy = useDataChartCopy()
  const patchWidgetParams = useDataChartParamsPatch()
  const selectedSession = params.view?.marketSession === 'extended' ? 'extended' : 'regular'
  const sessionLabel =
    selectedSession === 'extended' ? copy.footer.session.extended : copy.footer.session.regular
  const sessionIcon = selectedSession === 'extended' ? ClockPlus : Clock
  const tooltipLabel = `${sessionLabel}`

  const handleSessionSelect = (nextValue: 'regular' | 'extended') => {
    const nextView = { ...(params.view ?? {}) } as Record<string, unknown>
    nextView.marketSession = nextValue
    patchWidgetParams({
      view: nextView,
    })
  }

  const SessionIcon = sessionIcon

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={<button type='button' className={widgetHeaderIconButtonClassName()} />}
              >
                <SessionIcon className='h-3.5 w-3.5' />
                <span className='sr-only'>{copy.footer.session.ariaLabel}</span>
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className={cn(widgetHeaderMenuContentClassName, 'w-44')}>
        {(['regular', 'extended'] as const).map((mode) => {
          const label =
            mode === 'extended'
              ? copy.footer.session.extendedOption
              : copy.footer.session.regularOption
          const isSelected = mode === selectedSession
          return (
            <DropdownMenuItem
              key={mode}
              closeOnClick={false}
              onClick={() => {
                handleSessionSelect(mode)
              }}
              className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
            >
              <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>{label}</span>
              {isSelected ? <Check className='ml-auto h-3.5 w-3.5 text-primary' /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const DataChartNormalizationDropdown = ({
  params,
  panelId,
  widgetKey,
}: DataChartNormalizationDropdownProps) => {
  const copy = useDataChartCopy()
  const patchWidgetParams = useDataChartParamsPatch()
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
    ? formatDataChartNormalizationTooltip(copy, getDataChartNormalizationLabel(copy, effectiveMode))
    : copy.footer.normalization.unavailable

  const handleNormalizationSelect = (nextMode: string | null) => {
    const { normalization_mode: _normalizationMode, ...nextProviderParamsBase } = (params.data
      ?.providerParams ?? {}) as Record<string, unknown>
    const nextProviderParams = { ...nextProviderParamsBase }
    if (nextMode) {
      nextProviderParams.normalization_mode = nextMode
    }
    patchWidgetParams({
      data: {
        ...(params.data ?? {}),
        providerParams: nextProviderParams,
      },
    })
  }

  const isDisabled = !providerId || supportedModes.length === 0

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <span className='inline-flex'>
              <DropdownMenuTrigger
                render={
                  <button
                    type='button'
                    className={widgetHeaderIconButtonClassName()}
                    disabled={isDisabled}
                  />
                }
              >
                <ChartNetwork className='h-3.5 w-3.5' />
                <span className='sr-only'>{copy.footer.normalization.ariaLabel}</span>
              </DropdownMenuTrigger>
            </span>
          }
        />
        <TooltipContent side='top'>{tooltipLabel}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align='end' className={cn(widgetHeaderMenuContentClassName, 'w-52')}>
        {supportedModes.length === 0 ? (
          <div className='px-2 py-2 text-muted-foreground text-xs'>
            {copy.footer.normalization.noOptions}
          </div>
        ) : (
          <>
            {supportedModes.map((mode) => {
              const isSelected = mode === effectiveMode
              return (
                <DropdownMenuItem
                  key={mode}
                  closeOnClick={false}
                  onClick={() => {
                    handleNormalizationSelect(mode)
                  }}
                  className={cn(widgetHeaderMenuItemClassName, 'cursor-pointer')}
                >
                  <span className={cn(widgetHeaderMenuTextClassName, 'truncate')}>
                    {getDataChartNormalizationLabel(copy, mode)}
                  </span>
                  {isSelected ? <Check className='ml-auto h-3.5 w-3.5 text-primary' /> : null}
                </DropdownMenuItem>
              )
            })}
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
  const copy = useDataChartCopy()
  const patchWidgetParams = useDataChartParamsPatch()
  const availablePresets = DEFAULT_RANGE_PRESETS.filter(
    (preset) => !preset.interval || allowedIntervals.includes(preset.interval)
  )
  const storedRangeId =
    typeof params.view?.rangePresetId === 'string' ? params.view.rangePresetId.trim() : ''
  const selectedRangeId = storedRangeId
    ? (availablePresets.find((preset) => preset.id === storedRangeId)?.id ?? null)
    : null

  const handleRangeSelect = (presetId: string) => {
    const preset = availablePresets.find((range) => range.id === presetId)
    if (!preset) return

    const anchor = new Date(0)
    const rangeEnd = addRangeToDate(anchor, preset.range)
    const rangeMs = rangeEnd.getTime() - anchor.getTime()
    const fallbackInterval = params.view?.interval
    const presetInterval = preset.interval
    const interval =
      presetInterval ?? chooseIntervalForRange(rangeMs, allowedIntervals) ?? fallbackInterval
    const {
      window: _window,
      fallbackWindow: _fallbackWindow,
      ...nextDataBase
    } = (params.data ?? {}) as Record<string, unknown>
    const nextData = { ...nextDataBase }

    const {
      start: _start,
      end: _end,
      ...nextViewBase
    } = (params.view ?? {}) as Record<string, unknown>
    const nextView: Record<string, unknown> = {
      ...nextViewBase,
      rangePresetId: preset.id,
    }
    if (interval) {
      nextView.interval = interval
    }

    patchWidgetParams({
      data: nextData,
      view: nextView,
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
    <div className='border-border/60 border-t bg-background'>
      <div
        ref={footerScrollRef}
        onWheel={handleHorizontalWheel}
        className='flex w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        aria-label={copy.footer.ariaLabel}
      >
        <div className='flex w-full flex-nowrap items-center gap-4 py-0.5 font-medium text-accent-foreground text-sm'>
          <div className='flex h-8 flex-grow basis-0 items-center justify-start gap-2 whitespace-nowrap pl-1 text-left'>
            <div className='w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
              <Tabs
                value={selectedRangeId ?? ''}
                onValueChange={handleRangeSelect}
                className='w-max'
              >
                <TabsList className='h-7 w-max justify-start gap-1 rounded-sm bg-muted p-1'>
                  {availablePresets.map((preset) => (
                    <TabsTrigger
                      key={preset.id}
                      value={preset.id}
                      className='rounded-sm px-2 py-1 font-medium text-xs transition-colors data-[active]:shadow-sm'
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span className='inline-flex items-center'>
                              {getDataChartRangePresetLabel(copy, preset.id)}
                            </span>
                          }
                        />
                        <TooltipContent side='top'>
                          {(() => {
                            const anchor = new Date(0)
                            const rangeEnd = addRangeToDate(anchor, preset.range)
                            const rangeMs = rangeEnd.getTime() - anchor.getTime()
                            const resolvedInterval =
                              preset.interval ??
                              chooseIntervalForRange(rangeMs, allowedIntervals) ??
                              (typeof params.view?.interval === 'string'
                                ? params.view.interval
                                : null)
                            const rangeLabel =
                              preset.id === 'all'
                                ? copy.footer.range.allAvailableData
                                : formatDataChartRangeLabel(copy, preset.range)
                            const intervalLabel = resolvedInterval
                              ? formatDataChartIntervalLabel(copy, resolvedInterval)
                              : null
                            return intervalLabel
                              ? formatDataChartRangeIntervalTooltip(copy, rangeLabel, intervalLabel)
                              : rangeLabel
                          })()}
                        </TooltipContent>
                      </Tooltip>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </div>
          <div className='flex h-8 flex-grow basis-0 items-center justify-center gap-2 whitespace-nowrap text-center' />
          <div className='flex h-8 flex-grow basis-0 items-center justify-end gap-2 whitespace-nowrap pr-1 text-right'>
            <DataChartTimezoneDropdown
              params={params}
              panelId={panelId}
              widgetKey={widgetKey}
              exchangeTimezone={exchangeTimezone}
            />
            <DataChartMarketSessionDropdown
              params={params}
              panelId={panelId}
              widgetKey={widgetKey}
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
