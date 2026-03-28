'use client'

import React from 'react'
import { Indicator, PineTS } from 'pinets'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import { normalizeContext } from '@/lib/indicators/normalize-context'
import { buildIndexMaps, mapMarketSeriesToBarsMs } from '@/lib/indicators/series-data'
import type { BarMs, NormalizedPineOutput } from '@/lib/indicators/types'
import type { ListingOption } from '@/lib/listing/identity'
import {
  buildNextMockMarketBar,
  evolveMockMarketBar,
  generateMockMarketSeries,
} from '@/lib/market/mock-series'
import type { WidgetInstance } from '@/widgets/layout'
import {
  emitDataChartParamsChange,
  useDataChartParamsPersistence,
} from '@/widgets/utils/chart-params'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'
import { DataChartCandleTypeDropdown } from '@/widgets/widgets/data_chart/components/chart-controls'
import { ChartPaneOverlays } from '@/widgets/widgets/data_chart/components/chart-pane-overlays'
import { DrawToolsSidebar } from '@/widgets/widgets/data_chart/components/draw-tools-sidebar'
import { IndicatorSettingsModal } from '@/widgets/widgets/data_chart/components/indicator-settings-modal'
import { useChartInstance } from '@/widgets/widgets/data_chart/hooks/use-chart-instance'
import { useChartLegend } from '@/widgets/widgets/data_chart/hooks/use-chart-legend'
import { useIndicatorControls } from '@/widgets/widgets/data_chart/hooks/use-indicator-controls'
import { useIndicatorLegend } from '@/widgets/widgets/data_chart/hooks/use-indicator-legend'
import { useManualDrawToolsController } from '@/widgets/widgets/data_chart/hooks/use-manual-draw-tools-controller'
import { usePaneLayoutController } from '@/widgets/widgets/data_chart/hooks/use-pane-layout-controller'
import type {
  DataChartDataContext,
  DataChartWidgetParams,
  IndicatorRef,
  IndicatorRuntimeEntry,
} from '@/widgets/widgets/data_chart/types'
import { DEFAULT_MANUAL_DRAW_TOOLS } from '@/widgets/widgets/data_chart/utils/draw-tools'
import { buildIndicatorRefs } from '@/widgets/widgets/data_chart/utils/indicator-refs'
import {
  DEFAULT_LANDING_MARKET_INDICATOR_IDS,
  LANDING_MARKET_INDICATOR_MAP,
  LANDING_MARKET_INDICATOR_OPTIONS,
} from './indicators/catalog'
import { LandingIndicatorDropdown } from './landing-indicator-dropdown'
import { LandingWidgetShell } from './landing-widget-shell'
import { MarketChart } from './market-chart'

const INITIAL_BAR_COUNT = 2000
const LIVE_INTERVAL_MS = 60_000
const STREAM_TICK_MS = 1400
const DRAW_TOOLS_SIDEBAR_WIDTH_PX = 40
const LEFT_OVERLAY_GAP_PX = 3
const LEFT_OVERLAY_INSET_PX = DRAW_TOOLS_SIDEBAR_WIDTH_PX + LEFT_OVERLAY_GAP_PX
const MARKET_LISTING_LABEL = 'TradingGoose Data Chart'
const MARKET_INTERVAL_LABEL = '1m'
const LANDING_MARKET_PANEL_ID = 'landing-market-preview'
const LANDING_MARKET_CHART_RESET_KEY = 'landing-market-preview'
const LANDING_MARKET_WIDGET: NonNullable<WidgetInstance> = {
  key: 'data_chart',
}
const LANDING_MARKET_LISTING: ListingOption = {
  listing_id: 'tradinggoose-data-chart',
  base_id: '',
  quote_id: '',
  listing_type: 'default',
  base: MARKET_LISTING_LABEL,
  name: null,
  iconUrl: '/favicon/goose.png',
}
const BACKFILL_CHUNK_BARS = 1000
const BACKFILL_WINDOW_SEGMENTS = 3

let landingPreviewTriggerShimLock: Promise<void> = Promise.resolve()

const acquireLandingPreviewTriggerShim = async () => {
  const previousLock = landingPreviewTriggerShimLock
  let releaseLock = () => undefined
  landingPreviewTriggerShimLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  await previousLock

  const previousTrigger = (globalThis as { trigger?: (() => void) | undefined }).trigger
  ;(globalThis as { trigger?: () => void }).trigger = () => {
    // The landing preview does not collect trigger payloads; it only needs the
    // global symbol to exist while client-side PineTS evaluates trigger().
  }

  return () => {
    if (previousTrigger === undefined) {
      delete (globalThis as { trigger?: () => void }).trigger
    } else {
      ;(globalThis as { trigger?: () => void }).trigger = previousTrigger
    }
    releaseLock()
  }
}

type IndicatorExecutionState = {
  status: 'loading' | 'ready' | 'error'
  output: NormalizedPineOutput | null
  warnings: string[]
  error: string | null
}

const getLiveBucketOpenTime = (timeMs: number) =>
  Math.floor(timeMs / LIVE_INTERVAL_MS) * LIVE_INTERVAL_MS

const resolveBrowserTimezone = () => {
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim()
    return timezone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const buildSeedMarketBars = (endTimeMs: number) =>
  mapMarketSeriesToBarsMs(
    generateMockMarketSeries({
      bars: INITIAL_BAR_COUNT,
      intervalMs: LIVE_INTERVAL_MS,
      endTimeMs,
    }),
    LIVE_INTERVAL_MS
  )

const updateLiveBar = (bar: BarMs): BarMs => {
  const nextBar = evolveMockMarketBar(bar)

  return {
    ...bar,
    close: nextBar.close,
    high: nextBar.high,
    low: nextBar.low,
    closeTime: bar.openTime + LIVE_INTERVAL_MS,
    volume: nextBar.volume,
  }
}

const buildNextLiveBar = (previousBar: BarMs, openTime: number): BarMs => {
  const nextBar = buildNextMockMarketBar(previousBar)

  return {
    openTime,
    closeTime: openTime + LIVE_INTERVAL_MS,
    open: nextBar.open,
    high: nextBar.high,
    low: nextBar.low,
    close: nextBar.close,
    volume: nextBar.volume,
  }
}

const isFiniteLogicalRange = (
  range: { from: number; to: number } | null
): range is { from: number; to: number } =>
  Boolean(range && Number.isFinite(range.from) && Number.isFinite(range.to))

const resolveVisibleBars = (visibleRange: { from: number; to: number }) =>
  Math.max(1, Math.ceil(visibleRange.to) - Math.floor(visibleRange.from) + 1)

const resolvePrefetchBarsNeeded = (
  visibleRange: { from: number; to: number },
  totalBars: number
) => {
  if (totalBars <= 0) return 0

  const visibleBars = resolveVisibleBars(visibleRange)
  const targetBars = visibleBars * BACKFILL_WINDOW_SEGMENTS
  const maxIndex = totalBars - 1
  const fromIndexRaw = Math.floor(Math.min(visibleRange.from, visibleRange.to))
  const fromIndex = Math.max(0, Math.min(fromIndexRaw, maxIndex))
  const beforeBars = Math.max(0, fromIndex)
  const leftPaddingTarget = Math.max(0, targetBars - visibleBars)
  const leftPaddingDeficit = Math.max(0, leftPaddingTarget - beforeBars)
  const totalDeficit = Math.max(0, targetBars - totalBars)

  return Math.max(leftPaddingDeficit, totalDeficit)
}

const buildInitialMarketParams = (): DataChartWidgetParams => ({
  view: {
    candleType: 'candle_solid',
    pineIndicators: buildIndicatorRefs(DEFAULT_LANDING_MARKET_INDICATOR_IDS),
    drawTools: DEFAULT_MANUAL_DRAW_TOOLS,
  },
})

const getLatestNumericValue = (points: NormalizedPineOutput['series'][number]['points']) => {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }

  return null
}

function MarketHeaderChartControls({
  params,
  selectedIndicatorIds,
  onIndicatorChange,
}: {
  params: DataChartWidgetParams
  selectedIndicatorIds: string[]
  onIndicatorChange: (ids: string[]) => void
}) {
  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <DataChartCandleTypeDropdown
        params={params}
        candleType={params.view?.candleType}
        panelId={LANDING_MARKET_PANEL_ID}
        widgetKey={LANDING_MARKET_WIDGET.key}
      />
      <LandingIndicatorDropdown
        value={selectedIndicatorIds}
        options={LANDING_MARKET_INDICATOR_OPTIONS}
        onChange={onIndicatorChange}
      />
    </div>
  )
}

export function MarketPreview() {
  const initialBucketOpenTime = React.useMemo(() => getLiveBucketOpenTime(Date.now()), [])
  const mockBars = React.useMemo(
    () => buildSeedMarketBars(initialBucketOpenTime),
    [initialBucketOpenTime]
  )
  const [bars, setBars] = React.useState<BarMs[]>(() => mockBars)
  const barsRef = React.useRef<BarMs[]>(mockBars)
  const isBackfillingRef = React.useRef(false)
  const pendingBackfillRangeRef = React.useRef<{ from: number; to: number } | null>(null)
  const [browserTimezone, setBrowserTimezone] = React.useState('UTC')
  const [marketParams, setMarketParams] =
    React.useState<DataChartWidgetParams>(buildInitialMarketParams)
  const [indicatorStates, setIndicatorStates] = React.useState<
    Record<string, IndicatorExecutionState>
  >({})
  const indicatorRuntimeRef = React.useMemo(
    () => ({ current: new Map<string, IndicatorRuntimeEntry>() }),
    []
  )
  const [indicatorRuntimeVersion, setIndicatorRuntimeVersion] = React.useState(0)
  const legendContainerRef = React.useRef<HTMLDivElement | null>(null)
  const [legendOffset, setLegendOffset] = React.useState(0)

  const handleWidgetParamsChange = React.useCallback(
    (nextParams: Record<string, unknown> | null) => {
      if (nextParams) setMarketParams(nextParams as DataChartWidgetParams)
    },
    []
  )

  useDataChartParamsPersistence({
    onWidgetParamsChange: handleWidgetParamsChange,
    panelId: LANDING_MARKET_PANEL_ID,
    widget: LANDING_MARKET_WIDGET,
    params: marketParams as Record<string, unknown>,
  })

  const {
    chartRef,
    chartContainerRef,
    chartContainerCallbackRef,
    mainSeriesRef,
    chartReady,
    registerBeforeDestroy,
  } = useChartInstance(LANDING_MARKET_CHART_RESET_KEY)

  React.useEffect(() => {
    const nextTimezone = resolveBrowserTimezone()
    setBrowserTimezone((current) => (current === nextTimezone ? current : nextTimezone))

    const browserBucketOpenTime = getLiveBucketOpenTime(Date.now())
    setBars((current) => {
      const lastBar = current[current.length - 1]
      if (lastBar?.openTime === browserBucketOpenTime) {
        return current
      }
      return buildSeedMarketBars(browserBucketOpenTime)
    })
  }, [])

  React.useEffect(() => {
    barsRef.current = bars
  }, [bars])

  React.useEffect(() => {
    const timer = window.setInterval(() => {
      setBars((current) => {
        const lastBar = current[current.length - 1]
        if (!lastBar) {
          return current
        }
        const currentBucketOpenTime = getLiveBucketOpenTime(Date.now())
        if (lastBar.openTime < currentBucketOpenTime) {
          const nextBars = [...current]
          let previousBar = lastBar
          let nextOpenTime = previousBar.openTime + LIVE_INTERVAL_MS

          while (nextOpenTime <= currentBucketOpenTime) {
            const nextBar = buildNextLiveBar(previousBar, nextOpenTime)
            nextBars.push(nextBar)
            previousBar = nextBar
            nextOpenTime += LIVE_INTERVAL_MS
          }

          return nextBars
        }
        const nextBars = [...current]
        nextBars[nextBars.length - 1] = updateLiveBar(lastBar)
        return nextBars
      })
    }, STREAM_TICK_MS)

    return () => window.clearInterval(timer)
  }, [])

  React.useEffect(() => {
    const nextRange = pendingBackfillRangeRef.current
    const chart = chartRef.current
    if (!nextRange || !chart) return

    const timeScale = chart.timeScale()
    let rafA = 0
    let rafB = 0

    rafA = window.requestAnimationFrame(() => {
      rafB = window.requestAnimationFrame(() => {
        try {
          timeScale.setVisibleLogicalRange(nextRange)
        } catch {
          // Ignore transient chart update races after prepending history.
        }
        pendingBackfillRangeRef.current = null
        isBackfillingRef.current = false
      })
    })

    return () => {
      window.cancelAnimationFrame(rafA)
      window.cancelAnimationFrame(rafB)
    }
  }, [bars.length, chartReady, chartRef])

  React.useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const timeScale = chart.timeScale()

    const handleVisibleRangeChange = (range: { from: number; to: number } | null) => {
      if (!isFiniteLogicalRange(range)) return
      if (isBackfillingRef.current) return

      const barsLength = barsRef.current.length
      const barsNeeded = resolvePrefetchBarsNeeded(range, barsLength)
      if (barsNeeded <= 0) return

      isBackfillingRef.current = true

      setBars((current) => {
        const oldestBar = current[0]
        if (!oldestBar) {
          isBackfillingRef.current = false
          return current
        }

        const olderBars = mapMarketSeriesToBarsMs(
          generateMockMarketSeries({
            bars: BACKFILL_CHUNK_BARS,
            intervalMs: LIVE_INTERVAL_MS,
            endTimeMs: oldestBar.openTime - LIVE_INTERVAL_MS,
            initialPrice: oldestBar.open,
            endClose: oldestBar.open,
          }),
          LIVE_INTERVAL_MS
        )

        if (olderBars.length === 0) {
          isBackfillingRef.current = false
          return current
        }

        pendingBackfillRangeRef.current = {
          from: range.from + olderBars.length,
          to: range.to + olderBars.length,
        }

        return [...olderBars, ...current]
      })
    }

    timeScale.subscribeVisibleLogicalRangeChange(handleVisibleRangeChange)

    return () => {
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange)
      } catch {
        // Ignore chart teardown races during landing preview unmount.
      }
    }
  }, [chartReady, chartRef])

  const rawPineIndicators = Array.isArray(marketParams.view?.pineIndicators)
    ? marketParams.view.pineIndicators
    : []

  // Serialize refs to detect input changes (reference comparison alone misses nested input updates)
  const indicatorRefsKey = React.useMemo(
    () => JSON.stringify(rawPineIndicators),
    [rawPineIndicators]
  )

  const selectedIndicatorRefs = React.useMemo(
    () =>
      rawPineIndicators.filter(
        (ref): ref is IndicatorRef =>
          Boolean(ref) && typeof ref.id === 'string' && LANDING_MARKET_INDICATOR_MAP.has(ref.id)
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [indicatorRefsKey]
  )

  const selectedIndicatorIds = React.useMemo(
    () => selectedIndicatorRefs.map((ref) => ref.id),
    [selectedIndicatorRefs]
  )

  React.useEffect(() => {
    let isActive = true

    if (selectedIndicatorRefs.length === 0) {
      setIndicatorStates({})
      return () => {
        isActive = false
      }
    }

    setIndicatorStates((current) => {
      const nextEntries = selectedIndicatorRefs.map((ref) => [
        ref.id,
        {
          status: 'loading',
          output: current[ref.id]?.output ?? null,
          warnings: [],
          error: null,
        } satisfies IndicatorExecutionState,
      ])
      return Object.fromEntries(nextEntries)
    })

    const run = async () => {
      const nextStates = await Promise.all(
        selectedIndicatorRefs.map(async (ref) => {
          const indicator = LANDING_MARKET_INDICATOR_MAP.get(ref.id)
          if (!indicator) {
            return [
              ref.id,
              {
                status: 'error',
                output: null,
                warnings: [],
                error: 'Indicator is not available in this showcase.',
              } satisfies IndicatorExecutionState,
            ] as const
          }

          try {
            const pine = new PineTS(bars, 'SIM:GOOSE', '1m')
            await pine.ready()
            const inputsMap = buildInputsMapFromMeta(
              indicator.definition.inputMeta,
              ref.inputs ?? undefined
            )

            let context: any
            const requiresTriggerShim = indicator.definition.pineCode.includes('trigger(')
            let releaseTriggerShim: (() => void) | null = null
            if (requiresTriggerShim) {
              releaseTriggerShim = await acquireLandingPreviewTriggerShim()
            }
            try {
              context = await pine.run(new Indicator(indicator.definition.pineCode, inputsMap))
            } finally {
              releaseTriggerShim?.()
            }

            const { output, warnings } = normalizeContext({
              context,
              ...buildIndexMaps(bars),
              triggerSignals: [],
            })

            // Post-process: apply input.bool visibility toggles that client-side
            // PineTS can't handle in ternaries (TimeSeries objects are always truthy).
            // Check each bool input — if its title matches "Show X line" and the value
            // is false, null out the matching plot's data points so the line disappears
            // but the series (and its pane control) remains.
            if (output && indicator.definition.inputMeta) {
              const meta = indicator.definition.inputMeta
              Object.entries(meta).forEach(([title, inputDef]) => {
                if (inputDef.type !== 'bool') return
                const inputValue = inputsMap[title]
                if (inputValue !== false && inputValue !== 0) return
                const match = title.match(/^show\s+(.+?)(?:\s+line)?$/i)
                if (!match) return
                const plotName = match[1].toLowerCase()
                output.series.forEach((s) => {
                  if (s.plot.title.toLowerCase().includes(plotName)) {
                    s.points = s.points.map((p) => ({ ...p, value: null }))
                  }
                })
              })
            }

            return [
              ref.id,
              {
                status: 'ready',
                output,
                warnings: warnings.map((warning) => warning.message),
                error: null,
              } satisfies IndicatorExecutionState,
            ] as const
          } catch (error) {
            return [
              ref.id,
              {
                status: 'error',
                output: null,
                warnings: [],
                error: error instanceof Error ? error.message : String(error),
              } satisfies IndicatorExecutionState,
            ] as const
          }
        })
      )

      if (!isActive) return
      setIndicatorStates(Object.fromEntries(nextStates))
    }

    void run()

    return () => {
      isActive = false
    }
  }, [bars, selectedIndicatorRefs])

  const dataVersion = bars[bars.length - 1]?.openTime ?? 0
  const dataContext = React.useMemo<DataChartDataContext>(
    () => ({
      barsMsRef: { current: [] },
      indexByOpenTimeMsRef: { current: new Map<number, number>() },
      openTimeMsByIndexRef: { current: [] },
      marketSessionsRef: { current: [] },
      intervalMs: LIVE_INTERVAL_MS,
      dataVersion: 0,
    }),
    []
  )

  const indexMaps = React.useMemo(() => buildIndexMaps(bars), [bars])
  dataContext.barsMsRef.current = bars
  dataContext.indexByOpenTimeMsRef.current = indexMaps.indexByOpenTimeMs
  dataContext.openTimeMsByIndexRef.current = indexMaps.openTimeMsByIndex
  dataContext.marketSessionsRef.current = []
  dataContext.dataVersion = dataVersion

  const { paneSnapshot, paneLayout, handleMovePaneUp, handleMovePaneDown } =
    usePaneLayoutController({
      chartRef,
      chartContainerRef,
      chartReady,
      indicatorRuntimeVersion,
      chartResetKey: LANDING_MARKET_CHART_RESET_KEY,
    })

  const legendData = useChartLegend({
    chartRef,
    mainSeriesRef,
    dataContext,
    seriesTimezone: browserTimezone,
    view: marketParams.view,
    chartReady,
  })

  const indicatorLegend = useIndicatorLegend({
    chartRef,
    indicatorRuntimeRef,
    view: marketParams.view,
    chartReady,
    dataVersion,
    runtimeVersion: indicatorRuntimeVersion,
  })

  const indicatorRefsById = React.useMemo(
    () => new Map(selectedIndicatorRefs.map((ref) => [ref.id, ref])),
    [selectedIndicatorRefs]
  )

  const hiddenIndicators = React.useMemo(() => {
    const hidden = new Set<string>()
    selectedIndicatorRefs.forEach((ref) => {
      if (ref.visible === false) {
        hidden.add(ref.id)
      }
    })
    return hidden
  }, [selectedIndicatorRefs])

  const indicatorMetaById = React.useMemo(
    () =>
      new Map(
        LANDING_MARKET_INDICATOR_OPTIONS.map((indicator) => [
          indicator.id,
          {
            name: indicator.name,
            inputMeta: indicator.definition.inputMeta ?? undefined,
          },
        ])
      ),
    []
  )

  const {
    settingsIndicatorId,
    settingsDraft,
    settingsMeta,
    handleToggleHidden,
    handleRemoveIndicator,
    handleOpenSettings,
    handleCloseSettings,
    handleSaveSettings,
    handleDraftChange,
    indicatorControlsByPane,
    hasIndicatorRuntime,
  } = useIndicatorControls({
    view: marketParams.view,
    panelId: LANDING_MARKET_PANEL_ID,
    widgetKey: LANDING_MARKET_WIDGET.key,
    pineIndicatorIds: selectedIndicatorIds,
    indicatorMetaById,
    indicatorRefsById,
    indicatorLegend,
    hiddenIndicators,
    indicatorRuntimeRef,
    indicatorRuntimeVersion,
    mainSeriesRef,
    paneSnapshot,
    chartResetKey: LANDING_MARKET_CHART_RESET_KEY,
  })

  const traceDrawRouting = React.useCallback(
    (_event: string, _details?: () => Record<string, unknown>) => undefined,
    []
  )

  const {
    activeManualOwnerId,
    hasActiveOwnerTools,
    activeOwnerVisibilityMode,
    resolveManualToolCapability,
    resolveNonSelectableToolActive,
    handleSelectManualTool,
    handleToggleAllManualVisibility,
    handleClearManualTools,
    handleHideSelectedDrawings,
    handleRemoveSelectedDrawings,
    resolveSelectedOwnerForPane,
  } = useManualDrawToolsController({
    view: marketParams.view,
    panelId: LANDING_MARKET_PANEL_ID,
    widgetKey: LANDING_MARKET_WIDGET.key,
    chartResetKey: LANDING_MARKET_CHART_RESET_KEY,
    chartRef,
    chartContainerRef,
    mainSeriesRef,
    chartReady,
    registerBeforeDestroy,
    dataVersion,
    indicatorRuntimeRef,
    indicatorRuntimeVersion,
    paneSnapshot,
    paneLayout,
    traceDrawRouting,
  })

  React.useEffect(() => {
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
  }, [legendData, hasIndicatorRuntime, selectedIndicatorIds])

  const handleIndicatorRuntimeChange = React.useCallback(() => {
    setIndicatorRuntimeVersion((current) => current + 1)
  }, [])

  const handleIndicatorSelectionChange = React.useCallback(
    (nextIds: string[]) => {
      emitDataChartParamsChange({
        params: {
          view: {
            pineIndicators: buildIndicatorRefs(nextIds, selectedIndicatorRefs),
          },
        },
        panelId: LANDING_MARKET_PANEL_ID,
        widgetKey: LANDING_MARKET_WIDGET.key,
      })
    },
    [selectedIndicatorRefs]
  )

  const renderedIndicators = React.useMemo(
    () =>
      selectedIndicatorIds.map((id) => ({
        id,
        output: indicatorStates[id]?.output ?? null,
        visible: !hiddenIndicators.has(id),
        errorMessage: indicatorStates[id]?.error ?? undefined,
      })),
    [hiddenIndicators, indicatorStates, selectedIndicatorIds]
  )
  const primaryIndicatorId = selectedIndicatorIds[0] ?? null
  const primaryIndicatorOutput = primaryIndicatorId
    ? (indicatorStates[primaryIndicatorId]?.output ?? null)
    : null
  const primaryIndicatorValue = primaryIndicatorOutput?.series
    .map((series) => getLatestNumericValue(series.points))
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value))

  const indicatorErrors = React.useMemo(
    () =>
      selectedIndicatorIds.flatMap((id) =>
        indicatorStates[id]?.error ? [indicatorStates[id]?.error as string] : []
      ),
    [indicatorStates, selectedIndicatorIds]
  )

  const indicatorWarnings = React.useMemo(
    () => selectedIndicatorIds.flatMap((id) => indicatorStates[id]?.warnings ?? []),
    [indicatorStates, selectedIndicatorIds]
  )
  const mainPaneIndex = React.useMemo(() => {
    try {
      return mainSeriesRef.current?.getPane().paneIndex() ?? 0
    } catch {
      return 0
    }
  }, [chartReady, indicatorRuntimeVersion, mainSeriesRef])

  return (
    <div className='relative flex h-full min-h-[480px] flex-col gap-4'>
      <LandingWidgetShell
        widgetKey='data_chart'
        className='min-h-0 flex-1'
        headerRight={
          <MarketHeaderChartControls
            params={marketParams}
            selectedIndicatorIds={selectedIndicatorIds}
            onIndicatorChange={handleIndicatorSelectionChange}
          />
        }
      >
        <div className='flex h-full min-h-0 w-full flex-1 flex-col'>
          <div className='relative flex-1 overflow-hidden'>
            <DrawToolsSidebar
              activeOwnerId={activeManualOwnerId}
              sidebarWidthPx={DRAW_TOOLS_SIDEBAR_WIDTH_PX}
              hasOwnerTools={hasActiveOwnerTools}
              allVisibilityMode={activeOwnerVisibilityMode}
              getToolCapability={resolveManualToolCapability}
              isNonSelectableToolActive={resolveNonSelectableToolActive}
              onSelectTool={handleSelectManualTool}
              onToggleAllVisibility={handleToggleAllManualVisibility}
              onClearAll={handleClearManualTools}
            />

            <MarketChart
              bars={bars}
              indicators={renderedIndicators}
              chartRef={chartRef}
              chartContainerCallbackRef={chartContainerCallbackRef}
              mainSeriesRef={mainSeriesRef}
              chartReady={chartReady}
              candleType={marketParams.view?.candleType}
              timezone={browserTimezone}
              indicatorRuntimeRef={indicatorRuntimeRef}
              onIndicatorRuntimeChange={handleIndicatorRuntimeChange}
              className='relative z-0 h-full w-full bg-background text-foreground'
            />

            <ChartPaneOverlays
              paneSnapshot={paneSnapshot}
              paneLayout={paneLayout}
              mainPaneIndex={mainPaneIndex}
              legendOffset={legendOffset}
              legendData={legendData}
              listingLabel={MARKET_LISTING_LABEL}
              resolvedListing={LANDING_MARKET_LISTING}
              intervalLabel={MARKET_INTERVAL_LABEL}
              isResolving={false}
              legendContainerRef={legendContainerRef}
              leftOverlayInsetPx={LEFT_OVERLAY_INSET_PX}
              indicatorControlsByPane={indicatorControlsByPane}
              hasIndicatorRuntime={hasIndicatorRuntime}
              resolveSelectedOwnerForPane={resolveSelectedOwnerForPane}
              onToggleHidden={handleToggleHidden}
              onRemoveIndicator={handleRemoveIndicator}
              onOpenSettings={handleOpenSettings}
              onHideSelectedDrawings={handleHideSelectedDrawings}
              onRemoveSelectedDrawings={handleRemoveSelectedDrawings}
              onMovePaneUp={handleMovePaneUp}
              onMovePaneDown={handleMovePaneDown}
            />
          </div>
        </div>
      </LandingWidgetShell>

      {indicatorErrors.length > 0 ? (
        <div className='rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-destructive text-sm'>
          {indicatorErrors[0]}
        </div>
      ) : indicatorWarnings.length > 0 ? (
        <div className='rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-amber-700 text-sm'>
          {indicatorWarnings[0]}
        </div>
      ) : null}

      <IndicatorSettingsModal
        indicatorId={settingsIndicatorId}
        meta={settingsMeta}
        draft={settingsDraft}
        onDraftChange={handleDraftChange}
        onClose={handleCloseSettings}
        onSave={handleSaveSettings}
      />
    </div>
  )
}
