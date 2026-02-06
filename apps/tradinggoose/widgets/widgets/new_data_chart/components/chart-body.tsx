'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IPaneApi } from 'lightweight-charts'
import { X } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { DEFAULT_PINE_INDICATOR_MAP } from '@/lib/new_indicators/default'
import { buildInputsMapFromMeta } from '@/lib/new_indicators/input-meta'
import type { InputMetaMap } from '@/lib/new_indicators/types'
import { useSocket } from '@/contexts/socket-context'
import { useNewIndicators } from '@/hooks/queries/new-indicators'
import type { MarketSessionWindow } from '@/providers/market/types'
import { usePairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import type { WidgetComponentProps } from '@/widgets/types'
import {
  emitDataChartParamsChange,
  useDataChartParamsPersistence,
} from '@/widgets/utils/chart-params'
import { ChartLegend } from '@/widgets/widgets/new_data_chart/components/chart-legend'
import { DataChartFooter } from '@/widgets/widgets/new_data_chart/components/footer'
import { IndicatorControl } from '@/widgets/widgets/new_data_chart/components/indicator-control'
import { PaneControl } from '@/widgets/widgets/new_data_chart/components/pane-control'
import { useChartDataLoader } from '@/widgets/widgets/new_data_chart/hooks/use-chart-data-loader'
import { useChartDefaults } from '@/widgets/widgets/new_data_chart/hooks/use-chart-defaults'
import { useChartInstance } from '@/widgets/widgets/new_data_chart/hooks/use-chart-instance'
import { useChartLegend } from '@/widgets/widgets/new_data_chart/hooks/use-chart-legend'
import { useChartStyles } from '@/widgets/widgets/new_data_chart/hooks/use-chart-styles'
import { useChartVisibleRange } from '@/widgets/widgets/new_data_chart/hooks/use-chart-visible-range'
import {
  type IndicatorPlotValue,
  useIndicatorLegend,
} from '@/widgets/widgets/new_data_chart/hooks/use-indicator-legend'
import { useListingState } from '@/widgets/widgets/new_data_chart/hooks/use-listing-state'
import { useNewIndicatorSync } from '@/widgets/widgets/new_data_chart/hooks/use-new-indicator-sync'
import { useThemeVersion } from '@/widgets/widgets/new_data_chart/hooks/use-theme-version'
import type { BarMs } from '@/widgets/widgets/new_data_chart/series-data'
import { intervalToMs } from '@/widgets/widgets/new_data_chart/series-data'
import { resolveSeriesWindow } from '@/widgets/widgets/new_data_chart/series-window'
import type {
  DataChartWidgetParams,
  NewDataChartDataContext,
  NewDataChartWidgetParams,
} from '@/widgets/widgets/new_data_chart/types'
import {
  buildPineIndicatorRefs,
  resolvePineIndicatorIds,
} from '@/widgets/widgets/new_data_chart/utils/indicator-refs'
import { getListingSymbol } from '@/widgets/widgets/new_data_chart/utils/listing-utils'

export const NewDataChartWidgetBody = ({
  params,
  context,
  pairColor = 'gray',
  panelId,
  widget,
  onWidgetParamsChange,
}: WidgetComponentProps) => {
  const workspaceId = context?.workspaceId ?? null
  const resolvedPairColor = (pairColor ?? 'gray') as PairColor
  const pairContext = usePairColorContext(resolvedPairColor)
  useDataChartParamsPersistence({ onWidgetParamsChange, panelId, widget, params })

  const dataParams = useMemo(() => {
    if (!params || typeof params !== 'object') return {}
    return params as NewDataChartWidgetParams
  }, [params])
  const widgetKey = widget?.key ?? 'new_data_chart'

  const providerId = dataParams.data?.provider
  const listingValue =
    resolvedPairColor !== 'gray' ? (pairContext.listing ?? null) : (dataParams.listing ?? null)
  const seriesWindow = useMemo(
    () => resolveSeriesWindow(dataParams as DataChartWidgetParams, providerId),
    [
      providerId,
      dataParams.data?.interval,
      dataParams.view?.interval,
      dataParams.view?.rangePresetId,
    ]
  )

  const intervalLabel = seriesWindow.interval ?? ''
  const { listing, listingKey, resolvedListing, isResolving } = useListingState({
    listingValue,
    intervalLabel,
  })
  const listingLabel = useMemo(() => {
    if (resolvedListing) {
      const symbol = getListingSymbol(resolvedListing)
      const name = resolvedListing.name?.trim() ?? ''
      if (symbol && name && name !== symbol) {
        return `${symbol} · ${name}`
      }
      if (symbol) return symbol
      if (name) return name
      return null
    }
    return null
  }, [resolvedListing])

  const refreshAt =
    typeof dataParams.runtime?.refreshAt === 'number' ? dataParams.runtime.refreshAt : null
  const chartResetKey = useMemo(
    () =>
      [
        providerId ?? 'none',
        listingKey ?? 'none',
        seriesWindow.windowKey ?? 'none',
        seriesWindow.interval ?? '',
        refreshAt ? String(refreshAt) : '0',
      ].join('|'),
    [listingKey, providerId, refreshAt, seriesWindow.interval, seriesWindow.windowKey]
  )

  const { chartRef, chartContainerRef, mainSeriesRef, chartReady } =
    useChartInstance(chartResetKey)
  const { socket } = useSocket()
  const [dataVersion, setDataVersion] = useState(0)
  const lastLiveRefreshRef = useRef(0)
  const dataContext = useMemo<NewDataChartDataContext>(
    () => ({
      barsMsRef: { current: [] as BarMs[] },
      indexByOpenTimeMsRef: { current: new Map<number, number>() },
      openTimeMsByIndexRef: { current: [] as number[] },
      marketSessionsRef: { current: [] as MarketSessionWindow[] },
      intervalMs: null,
      dataVersion: 0,
    }),
    [chartResetKey]
  )
  const indicatorRuntimeRef = useMemo(
    () => ({ current: new Map<string, IndicatorRuntimeEntry>() }),
    [chartResetKey]
  )
  const [indicatorRuntimeVersion, setIndicatorRuntimeVersion] = useState(0)
  const [hiddenIndicators, setHiddenIndicators] = useState<Set<string>>(new Set())
  const [paneSnapshot, setPaneSnapshot] = useState<IPaneApi<any>[]>([])
  const [paneLayout, setPaneLayout] = useState<Array<{ top: number; height: number }>>([])
  const [settingsIndicatorId, setSettingsIndicatorId] = useState<string | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, unknown>>({})
  const legendContainerRef = useRef<HTMLDivElement | null>(null)
  const [legendOffset, setLegendOffset] = useState(0)

  useChartDefaults({
    dataParams: dataParams as DataChartWidgetParams,
    providerId,
    seriesWindow,
    onWidgetParamsChange,
    resolvedPairColor,
  })

  const intervalMs = intervalToMs(seriesWindow.interval ?? seriesWindow.requestInterval ?? null)
  dataContext.intervalMs = intervalMs
  dataContext.dataVersion = dataVersion

  const themeVersion = useThemeVersion()
  const handleDataLoaded = useCallback(() => {
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleDataUpdated = useCallback(() => {
    const now = Date.now()
    if (now - lastLiveRefreshRef.current < 10000) return
    lastLiveRefreshRef.current = now
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleDataBackfill = useCallback(() => {
    setDataVersion((prev) => prev + 1)
  }, [])
  const handleIndicatorRuntimeChange = useCallback(() => {
    setIndicatorRuntimeVersion((prev) => prev + 1)
  }, [])

  const { seriesTimezone, chartError, isLoading } = useChartDataLoader({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    socket,
    workspaceId,
    providerId,
    listing,
    seriesWindow,
    dataParams,
    dataContext,
    onDataLoaded: handleDataLoaded,
    onDataUpdated: handleDataUpdated,
    onDataBackfill: handleDataBackfill,
  })


  const { data: pineIndicators = [] } = useNewIndicators(workspaceId ?? '')
  const pineIndicatorIds = useMemo(
    () => resolvePineIndicatorIds(dataParams.view),
    [dataParams.view?.pineIndicators]
  )
  const pineIndicatorRefs = useMemo(
    () =>
      buildPineIndicatorRefs(
        pineIndicatorIds,
        Array.isArray(dataParams.view?.pineIndicators) ? dataParams.view?.pineIndicators : []
      ),
    [pineIndicatorIds, dataParams.view?.pineIndicators]
  )
  const indicatorRefsById = useMemo(
    () => new Map(pineIndicatorRefs.map((ref) => [ref.id, ref])),
    [pineIndicatorRefs]
  )
  const indicatorMetaById = useMemo(() => {
    const customMap = new Map(pineIndicators.map((indicator) => [indicator.id, indicator]))
    const metaMap = new Map<string, { name: string; inputMeta?: InputMetaMap | null }>()
    pineIndicatorIds.forEach((id) => {
      const custom = customMap.get(id)
      const fallback = DEFAULT_PINE_INDICATOR_MAP.get(id) ?? null
      metaMap.set(id, {
        name: custom?.name ?? fallback?.name ?? id,
        inputMeta: custom?.inputMeta ?? fallback?.inputMeta ?? undefined,
      })
    })
    return metaMap
  }, [pineIndicators, pineIndicatorIds])

  useNewIndicatorSync({
    chartRef,
    mainSeriesRef,
    dataContext,
    workspaceId,
    indicatorRefs: pineIndicatorRefs,
    indicators: pineIndicators,
    listingKey: listingKey ?? undefined,
    interval: seriesWindow.interval ?? seriesWindow.requestInterval ?? undefined,
    chartReady,
    indicatorRuntimeRef,
    onIndicatorRuntimeChange: handleIndicatorRuntimeChange,
  })

  useChartVisibleRange({
    chartRef,
    dataContext,
    params: dataParams,
    chartReady,
    interval: seriesWindow.interval ?? seriesWindow.requestInterval ?? null,
    panelId,
    widgetKey,
  })

  const legendData = useChartLegend({
    chartRef,
    mainSeriesRef,
    dataContext,
    chartReady,
    seriesTimezone,
    view: dataParams.view,
  })
  const indicatorLegend = useIndicatorLegend({
    chartRef,
    indicatorRuntimeRef,
    view: dataParams.view,
    chartReady,
  })

  const chartSettings = useMemo(() => {
    const view = dataParams.view ?? {}
    return {
      locale: view.locale,
      timezone: view.timezone,
      pricePrecision: view.pricePrecision,
      volumePrecision: view.volumePrecision,
      candleType: view.candleType,
      priceAxisType: view.priceAxisType,
      stylesOverride: view.stylesOverride,
    }
  }, [
    dataParams.view?.locale,
    dataParams.view?.timezone,
    dataParams.view?.pricePrecision,
    dataParams.view?.volumePrecision,
    dataParams.view?.candleType,
    dataParams.view?.priceAxisType,
    dataParams.view?.stylesOverride,
  ])

  useChartStyles({
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartSettings,
    seriesTimezone,
    themeVersion,
    dataContext,
    dataVersion,
    chartReady,
  })

  useEffect(() => {
    setPaneSnapshot([])
    setPaneLayout([])
  }, [chartResetKey])

  const refreshPaneSnapshot = useCallback(() => {
    if (!chartRef.current) return
    const panes = chartRef.current.panes()
    setPaneSnapshot((prev) => {
      if (prev.length === panes.length && prev.every((pane, index) => pane === panes[index])) {
        return prev
      }
      return panes
    })
  }, [chartRef])

  const updatePaneLayout = useCallback(() => {
    const container = chartContainerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const next: Array<{ top: number; height: number }> = []

    paneSnapshot.forEach((pane) => {
      const element = pane.getHTMLElement()
      if (!element) return
      const rect = element.getBoundingClientRect()
      const top = rect.top - containerRect.top
      const height = rect.height
      const index = pane.paneIndex()
      next[index] = { top, height }
    })

    setPaneLayout((prev) => {
      const maxLength = Math.max(prev.length, next.length)
      for (let i = 0; i < maxLength; i += 1) {
        const prevEntry = prev[i]
        const nextEntry = next[i]
        if (!prevEntry && !nextEntry) continue
        if (!prevEntry || !nextEntry) return next
        if (Math.abs(prevEntry.top - nextEntry.top) > 0.5) return next
        if (Math.abs(prevEntry.height - nextEntry.height) > 0.5) return next
      }
      return prev
    })
  }, [chartContainerRef, paneSnapshot])

  useEffect(() => {
    refreshPaneSnapshot()
  }, [chartReady, indicatorRuntimeVersion, refreshPaneSnapshot])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return
    let raf: number | null = null
    const schedule = () => {
      if (raf !== null) return
      raf = window.requestAnimationFrame(() => {
        raf = null
        updatePaneLayout()
      })
    }
    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    paneSnapshot.forEach((pane) => {
      const element = pane.getHTMLElement()
      if (element) observer.observe(element)
    })
    return () => {
      if (raf !== null) {
        window.cancelAnimationFrame(raf)
      }
      observer.disconnect()
    }
  }, [chartContainerRef, paneSnapshot, updatePaneLayout])

  useEffect(() => {
    indicatorRuntimeRef.current.forEach((entry, indicatorId) => {
      const isHidden = hiddenIndicators.has(indicatorId)
      entry.plots.forEach((plot) => {
        if (typeof (plot.series as { applyOptions?: unknown }).applyOptions === 'function') {
          ;(plot.series as { applyOptions: (options: { visible: boolean }) => void }).applyOptions({
            visible: !isHidden,
          })
        }
      })
    })
  }, [hiddenIndicators, indicatorRuntimeVersion])

  useEffect(() => {
    const element = legendContainerRef.current
    if (!element) {
      setLegendOffset(0)
      return
    }
    const update = () => {
      setLegendOffset(element.getBoundingClientRect().height)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [legendData, listingLabel, resolvedListing, isResolving, intervalLabel])

  const handleToggleHidden = useCallback((indicatorId: string) => {
    setHiddenIndicators((prev) => {
      const next = new Set(prev)
      if (next.has(indicatorId)) {
        next.delete(indicatorId)
      } else {
        next.add(indicatorId)
      }
      return next
    })
  }, [])

  const handleRemoveIndicator = useCallback(
    (indicatorId: string) => {
      const view = dataParams.view ?? {}
      const currentRefs = Array.isArray(view.pineIndicators) ? view.pineIndicators : []
      const nextRefs = currentRefs.filter((ref) => ref.id !== indicatorId)
      emitDataChartParamsChange({
        params: {
          view: {
            ...view,
            pineIndicators: nextRefs,
          },
        },
        panelId,
        widgetKey,
      })
      setHiddenIndicators((prev) => {
        if (!prev.has(indicatorId)) return prev
        const next = new Set(prev)
        next.delete(indicatorId)
        return next
      })
    },
    [dataParams.view, panelId, widgetKey]
  )

  const handleUpdateIndicatorInputs = useCallback(
    (indicatorId: string, inputs: Record<string, unknown>) => {
      const view = dataParams.view ?? {}
      const currentRefs = Array.isArray(view.pineIndicators) ? view.pineIndicators : []
      const hasExisting = currentRefs.some((ref) => ref.id === indicatorId)
      const nextRefs = hasExisting
        ? currentRefs.map((ref) => (ref.id === indicatorId ? { ...ref, inputs } : ref))
        : [...currentRefs, { id: indicatorId, inputs }]
      emitDataChartParamsChange({
        params: {
          view: {
            ...view,
            pineIndicators: nextRefs,
          },
        },
        panelId,
        widgetKey,
      })
    },
    [dataParams.view, panelId, widgetKey]
  )

  const handleOpenSettings = useCallback(
    (indicatorId: string) => {
      const meta = indicatorMetaById.get(indicatorId)
      const inputs = buildInputsMapFromMeta(
        meta?.inputMeta ?? undefined,
        indicatorRefsById.get(indicatorId)?.inputs
      )
      setSettingsIndicatorId(indicatorId)
      setSettingsDraft(inputs)
    },
    [indicatorMetaById, indicatorRefsById]
  )

  const handleCloseSettings = useCallback(() => {
    setSettingsIndicatorId(null)
    setSettingsDraft({})
  }, [])

  const handleSaveSettings = useCallback(() => {
    if (!settingsIndicatorId) return
    const meta = indicatorMetaById.get(settingsIndicatorId)
    const nextInputs = buildInputsMapFromMeta(meta?.inputMeta ?? undefined, settingsDraft)
    handleUpdateIndicatorInputs(settingsIndicatorId, nextInputs)
    handleCloseSettings()
  }, [
    settingsIndicatorId,
    indicatorMetaById,
    settingsDraft,
    handleUpdateIndicatorInputs,
    handleCloseSettings,
  ])

  const handleDraftChange = useCallback((title: string, value: unknown) => {
    setSettingsDraft((prev) => ({
      ...prev,
      [title]: value,
    }))
  }, [])

  const handleMovePaneUp = useCallback(
    (pane: IPaneApi<any>) => {
      const index = pane.paneIndex()
      if (index <= 0) return
      pane.moveTo(index - 1)
      refreshPaneSnapshot()
    },
    [refreshPaneSnapshot]
  )

  const handleMovePaneDown = useCallback(
    (pane: IPaneApi<any>) => {
      const index = pane.paneIndex()
      if (index >= paneSnapshot.length - 1) return
      pane.moveTo(index + 1)
      refreshPaneSnapshot()
    },
    [paneSnapshot.length, refreshPaneSnapshot]
  )

  const indicatorControlsByPane = useMemo(() => {
    const mainPaneIndex = mainSeriesRef.current?.getPane().paneIndex() ?? 0
    const grouped = new Map<
      number,
      Array<{
        id: string
        name: string
        inputMeta?: InputMetaMap | null
        inputs?: Record<string, unknown>
        values: IndicatorPlotValue[]
        isHidden: boolean
        errorMessage?: string
      }>
    >()

    pineIndicatorIds.forEach((id) => {
      const meta = indicatorMetaById.get(id)
      if (!meta) return
      const runtimeEntry = indicatorRuntimeRef.current.get(id)
      if (!runtimeEntry) return
      const paneIndex = runtimeEntry?.pane ? runtimeEntry.pane.paneIndex() : mainPaneIndex
      const list = grouped.get(paneIndex) ?? []
      list.push({
        id,
        name: meta.name,
        inputMeta: meta.inputMeta,
        inputs: indicatorRefsById.get(id)?.inputs,
        values: indicatorLegend.get(id) ?? [],
        isHidden: hiddenIndicators.has(id),
        errorMessage: runtimeEntry?.errorMessage,
      })
      grouped.set(paneIndex, list)
    })

    return grouped
  }, [
    pineIndicatorIds,
    indicatorMetaById,
    indicatorLegend,
    hiddenIndicators,
    indicatorRuntimeVersion,
    indicatorRefsById,
    paneSnapshot,
    chartResetKey,
  ])

  const hasIndicatorRuntime = indicatorRuntimeRef.current.size > 0

  const settingsMeta = useMemo(() => {
    if (!settingsIndicatorId) return null
    return indicatorMetaById.get(settingsIndicatorId) ?? null
  }, [settingsIndicatorId, indicatorMetaById])

  const settingsInputEntries = useMemo(() => {
    if (!settingsMeta?.inputMeta) return []
    return Object.entries(settingsMeta.inputMeta).map(([title, meta]) => ({ title, meta }))
  }, [settingsMeta])

  const resolveDraftValue = useCallback((value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return ''
  }, [])

  const hasProvider = Boolean(providerId)
  const hasListing = Boolean(listing)
  const showEmptyState = !hasProvider || !hasListing
  const showErrorState = !showEmptyState && Boolean(chartError) && !isLoading

  if (!workspaceId) {
    return (
      <div className='flex h-full w-full items-center justify-center px-4 text-center text-muted-foreground text-xs'>
        Select a workspace to load chart data.
      </div>
    )
  }

  const emptyTitle = !hasProvider
    ? hasListing
      ? 'Select a provider'
      : 'Select a provider and listing'
    : 'Select a listing'
  const emptyDescription = !hasProvider
    ? hasListing
      ? 'Choose a provider to display chart data.'
      : 'Choose a provider and listing to display chart data.'
    : 'Choose a listing to display chart data.'

  const errorTitle = 'Failed to load data'
  const errorDescription = chartError ?? 'Unable to load chart data.'

  return (
    <div className='relative flex h-full w-full flex-col'>
      <div className='relative flex-1 overflow-hidden'>
        <div
          ref={chartContainerRef}
          aria-hidden={showErrorState}
          className={`relative z-0 h-full w-full bg-background text-foreground${
            showErrorState ? ' pointer-events-none opacity-0' : ''
          }`}
        />
        {!showEmptyState && !showErrorState && (
          <div className='pointer-events-none absolute inset-0 z-10'>
            {(() => {
              const mainPaneIndex = mainSeriesRef.current?.getPane().paneIndex() ?? 0
              return paneSnapshot.map((pane) => {
                const paneIndex = pane.paneIndex()
                const layout = paneLayout[paneIndex]
                if (!layout) return null
                const indicatorItems = indicatorControlsByPane.get(paneIndex) ?? []
                const isMainPane = paneIndex === mainPaneIndex
                const topOffset = isMainPane ? legendOffset - 3 : 3

                return (
                  <div
                    key={`pane-overlay-${paneIndex}`}
                    className='absolute right-0 left-0'
                    style={{ top: `${layout.top}px`, height: `${layout.height}px` }}
                  >
                    <div className='relative h-full w-full'>
                      {isMainPane && (
                        <ChartLegend
                          legend={legendData}
                          listingLabel={listingLabel}
                          listing={resolvedListing}
                          intervalLabel={intervalLabel}
                          isResolving={isResolving}
                          containerRef={legendContainerRef}
                        />
                      )}
                      {hasIndicatorRuntime && indicatorItems.length > 0 && (
                        <div
                          className='pointer-events-none absolute left-[3px] mr-24 pr-20'
                          style={{ top: `${topOffset}px` }}
                        >
                          <div className='inline-flex flex-col items-start gap-1'>
                            {indicatorItems.map((item) => (
                              <div key={item.id} className='pointer-events-auto'>
                                <IndicatorControl
                                  indicatorId={item.id}
                                  name={item.name}
                                  inputMeta={item.inputMeta}
                                  indicatorInputs={item.inputs}
                                  plotValues={item.values}
                                  isHidden={item.isHidden}
                                  errorMessage={item.errorMessage}
                                  onToggleHidden={handleToggleHidden}
                                  onRemove={handleRemoveIndicator}
                                  onOpenSettings={handleOpenSettings}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {hasIndicatorRuntime && (
                        <div className='pointer-events-auto absolute top-[3px] right-[4px] pr-14'>
                          <PaneControl
                            paneIndex={paneIndex}
                            paneCount={paneSnapshot.length}
                            onMoveUp={() => handleMovePaneUp(pane)}
                            onMoveDown={() => handleMovePaneDown(pane)}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
          </div>
        )}
        {showEmptyState && (
          <div className='absolute inset-0 z-10 flex'>
            <Empty className='h-full w-full border-border/40 bg-background/60'>
              <EmptyHeader>
                <EmptyTitle>{emptyTitle}</EmptyTitle>
                <EmptyDescription>{emptyDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
        {showErrorState && (
          <div className='absolute inset-0 z-10 flex'>
            <Empty className='h-full w-full border-border/40 bg-background/60'>
              <EmptyHeader>
                <EmptyTitle>{errorTitle}</EmptyTitle>
                <EmptyDescription>{errorDescription}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        )}
      </div>
      {settingsMeta && (
        <div
          className='absolute inset-0 z-40 flex items-center justify-center bg-secondary/40 p-4 backdrop-blur-sm'
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              handleCloseSettings()
            }
          }}
        >
          <div className='w-full max-w-md rounded-md border border-border bg-background p-4 shadow-lg'>
            <div className='flex items-start justify-between gap-2'>
              <div>
                <p className='font-semibold text-base text-foreground'>{settingsMeta.name}</p>
                <p className='text-muted-foreground text-xs'>Indicator settings</p>
              </div>
              <button
                type='button'
                className='inline-flex h-8 w-8 items-center justify-center gap-2 whitespace-nowrap rounded-md bg-muted/40 p-0 font-medium text-sm ring-offset-background transition-colors hover:bg-muted hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0'
                onClick={handleCloseSettings}
              >
                <X aria-hidden='true' />
                <span className='sr-only'>Close</span>
              </button>
            </div>
            <div className='mt-4 space-y-3'>
              {settingsInputEntries.length === 0 ? (
                <p className='text-muted-foreground text-sm'>No configurable inputs.</p>
              ) : (
                settingsInputEntries.map(({ title, meta }) => {
                  const draftValue = settingsDraft[title]
                  const resolvedValue =
                    typeof draftValue !== 'undefined' ? draftValue : (meta.defval ?? '')
                  if (meta.type === 'bool') {
                    return (
                      <label
                        key={`${settingsIndicatorId}-${title}`}
                        className='flex items-center justify-between gap-3 text-sm'
                      >
                        <span className='font-medium text-foreground'>{title}</span>
                        <input
                          type='checkbox'
                          className='h-4 w-4 accent-primary'
                          checked={Boolean(resolvedValue)}
                          onChange={(event) => handleDraftChange(title, event.target.checked)}
                        />
                      </label>
                    )
                  }

                  if (Array.isArray(meta.options) && meta.options.length > 0) {
                    return (
                      <label
                        key={`${settingsIndicatorId}-${title}`}
                        className='flex flex-col gap-1 text-sm'
                      >
                        <span className='font-medium text-foreground'>{title}</span>
                        <select
                          className='h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                          value={resolveDraftValue(resolvedValue)}
                          onChange={(event) => handleDraftChange(title, event.target.value)}
                        >
                          {meta.options.map((option) => (
                            <option
                              key={`${settingsIndicatorId}-${title}-${String(option)}`}
                              value={String(option)}
                            >
                              {String(option)}
                            </option>
                          ))}
                        </select>
                      </label>
                    )
                  }

                  const isNumber = meta.type === 'int' || meta.type === 'float'
                  const inputId = `${settingsIndicatorId}-${title}-input`
                  return (
                    <label
                      key={`${settingsIndicatorId}-${title}`}
                      className='flex flex-col gap-1 text-sm'
                      htmlFor={inputId}
                    >
                      <span className='font-medium text-foreground'>{title}</span>
                      <Input
                        id={inputId}
                        type={isNumber ? 'number' : 'text'}
                        value={resolveDraftValue(resolvedValue)}
                        onChange={(event) => handleDraftChange(title, event.target.value)}
                        min={typeof meta.minval === 'number' ? meta.minval : undefined}
                        max={typeof meta.maxval === 'number' ? meta.maxval : undefined}
                        step={typeof meta.step === 'number' ? meta.step : undefined}
                      />
                    </label>
                  )
                })
              )}
            </div>
            <div className='mt-4 flex items-center justify-end gap-2'>
              <button
                type='button'
                className='inline-flex h-9 items-center justify-center rounded-sm border border-input px-3 text-foreground text-sm hover:bg-muted'
                onClick={handleCloseSettings}
              >
                Cancel
              </button>
              <button
                type='button'
                className='inline-flex h-9 items-center justify-center rounded-sm bg-primary px-3 text-primary-foreground text-sm hover:bg-primary-hover'
                onClick={handleSaveSettings}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
      <DataChartFooter
        params={dataParams as DataChartWidgetParams}
        widgetKey={widgetKey}
        panelId={panelId}
        allowedIntervals={seriesWindow.allowedIntervals}
        exchangeTimezone={seriesTimezone}
      />
    </div>
  )
}
