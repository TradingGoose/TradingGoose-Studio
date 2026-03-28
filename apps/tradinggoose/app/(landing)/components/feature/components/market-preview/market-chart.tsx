'use client'

import React, { type MutableRefObject } from 'react'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import {
  AreaSeries,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  LineSeries,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type TickMarkType,
  type Time,
} from 'lightweight-charts'
import type { BarMs, NormalizedPineFill, NormalizedPineOutput } from '@/lib/indicators/types'
import { cn } from '@/lib/utils'
import { useThemeVersion } from '@/widgets/widgets/data_chart/hooks/use-theme-version'
import { mapBarsMsToSeriesData } from '@/widgets/widgets/data_chart/series-data'
import type { DataChartCandleType, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'
import {
  buildSeriesOptions,
  formatLwcTick,
  formatLwcTime,
  resolveCandleType,
} from '@/widgets/widgets/data_chart/utils/chart-styles'

const INDICATOR_PALETTE = ['#38bdf8', '#14b8a6', '#8b5cf6', '#f59e0b']
const MARKET_PRICE_FORMAT = { precision: 2, minMove: 0.01 }

// ---------------------------------------------------------------------------
// Fill primitive — draws a gradient-filled area between two series (e.g. Bollinger Bands)
// Ported from widgets/data_chart/hooks/use-indicator-sync.ts
// ---------------------------------------------------------------------------
type FillRendererPoint = { x: number; upper: number; lower: number }

function createFillPrimitive(fill: NormalizedPineFill) {
  const state = {
    attached: null as SeriesAttachedParameter<any, any> | null,
    points: fill.points,
    topColor: fill.topColor,
    bottomColor: fill.bottomColor,
    visible: true,
  }

  const viewData = {
    points: [] as FillRendererPoint[],
    topColor: fill.topColor,
    bottomColor: fill.bottomColor,
    visible: true,
  }

  const updateView = () => {
    const attached = state.attached
    viewData.topColor = state.topColor
    viewData.bottomColor = state.bottomColor
    viewData.visible = state.visible
    if (!attached) { viewData.points = []; return }

    const timeScale = attached.chart.timeScale()
    const next: FillRendererPoint[] = []
    state.points.forEach((pt) => {
      const x = timeScale.timeToCoordinate(pt.time as any)
      const upper = attached.series.priceToCoordinate(pt.upper)
      const lower = attached.series.priceToCoordinate(pt.lower)
      if (typeof x === 'number' && Number.isFinite(x) &&
          typeof upper === 'number' && Number.isFinite(upper) &&
          typeof lower === 'number' && Number.isFinite(lower)) {
        next.push({ x, upper, lower })
      }
    })
    viewData.points = next
  }

  const renderer: IPrimitivePaneRenderer = {
    draw() {},
    drawBackground(target: CanvasRenderingTarget2D) {
      target.useMediaCoordinateSpace(({ context }) => {
        if (!viewData.visible || viewData.points.length < 2) return
        for (let i = 1; i < viewData.points.length; i++) {
          const prev = viewData.points[i - 1]
          const curr = viewData.points[i]
          if (!prev || !curr) continue
          const seg = new Path2D()
          seg.moveTo(prev.x, prev.upper)
          seg.lineTo(curr.x, curr.upper)
          seg.lineTo(curr.x, curr.lower)
          seg.lineTo(prev.x, prev.lower)
          seg.closePath()
          const uMid = (prev.upper + curr.upper) / 2
          const lMid = (prev.lower + curr.lower) / 2
          const grad = context.createLinearGradient(0, uMid, 0, lMid !== uMid ? lMid : lMid + 1)
          grad.addColorStop(0, viewData.topColor)
          grad.addColorStop(1, viewData.bottomColor)
          context.fillStyle = grad
          context.fill(seg)
        }
      })
    },
  }

  const paneView: IPrimitivePaneView = {
    zOrder: () => 'bottom' as const,
    renderer: () => renderer,
  }

  const primitive: ISeriesPrimitive<any> = {
    attached(a) { state.attached = a; a.requestUpdate() },
    detached() { state.attached = null },
    updateAllViews() { updateView() },
    paneViews() { return [paneView] },
  }

  return {
    primitive,
    update(f: NormalizedPineFill) {
      state.points = f.points; state.topColor = f.topColor; state.bottomColor = f.bottomColor
      state.visible = true; state.attached?.requestUpdate()
    },
    setVisible(v: boolean) { state.visible = v; state.attached?.requestUpdate() },
  }
}

type MarketChartIndicator = {
  id: string
  output: NormalizedPineOutput | null
  visible: boolean
  errorMessage?: string
}

type MainSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'>

type MarketChartProps = {
  bars: BarMs[]
  indicators: MarketChartIndicator[]
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerCallbackRef: (container: HTMLDivElement | null) => void
  mainSeriesRef: MutableRefObject<MainSeries | null>
  chartReady: number
  candleType?: DataChartCandleType
  timezone: string
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  onIndicatorRuntimeChange?: () => void
  className?: string
}

const getPaneIndex = (series: MainSeries | null) => {
  try {
    return series?.getPane().paneIndex() ?? 0
  } catch {
    return 0
  }
}

const getPane = (series: MainSeries | null) => {
  try {
    return series?.getPane() ?? null
  } catch {
    return null
  }
}

export function MarketChart({
  bars,
  indicators,
  chartRef,
  chartContainerCallbackRef,
  mainSeriesRef,
  chartReady,
  candleType,
  timezone,
  indicatorRuntimeRef,
  onIndicatorRuntimeChange,
  className,
}: MarketChartProps) {
  const indicatorSeriesRefs = React.useRef(new Map<string, Map<string, ISeriesApi<'Line'>>>())
  const seriesMarkersMapRef = React.useRef(new Map<ISeriesApi<any>, ISeriesMarkersPluginApi<any>>())
  const fillPrimitivesRef = React.useRef(new Map<string, { series: ISeriesApi<any>; primitive: ISeriesPrimitive<any>; update: (f: NormalizedPineFill) => void; setVisible: (v: boolean) => void }>())
  const runtimeSignatureRef = React.useRef('')
  const resolvedCandleType = React.useMemo(() => resolveCandleType(candleType), [candleType])
  const themeVersion = useThemeVersion()

  const seriesData = React.useMemo(
    () => mapBarsMsToSeriesData(bars, resolvedCandleType),
    [bars, resolvedCandleType]
  )

  // Map timestamp (seconds) → isUp for histogram coloring (volume)
  const barDirectionByTime = React.useMemo(() => {
    const map = new Map<number, boolean>()
    bars.forEach((bar) => {
      map.set(Math.floor(bar.openTime / 1000), bar.close >= bar.open)
    })
    return map
  }, [bars])

  React.useEffect(() => {
    indicatorSeriesRefs.current = new Map()
    indicatorRuntimeRef.current = new Map()
    if (runtimeSignatureRef.current !== '') {
      runtimeSignatureRef.current = ''
      onIndicatorRuntimeChange?.()
    }
  }, [chartReady, indicatorRuntimeRef, onIndicatorRuntimeChange])

  React.useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Read computed styles from the container so the chart matches the current theme
    const container = document.querySelector('.landing-market-chart')
    const computedStyles = container ? window.getComputedStyle(container) : null
    const fontFamily = computedStyles?.fontFamily?.trim() ?? ''
    const textColor = computedStyles?.color?.trim() ?? ''
    const backgroundColor = computedStyles?.backgroundColor?.trim() ?? ''

    chart.applyOptions({
      layout: {
        ...(fontFamily ? { fontFamily } : {}),
        ...(textColor ? { textColor } : {}),
        ...(backgroundColor &&
        backgroundColor !== 'transparent' &&
        backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? { background: { color: backgroundColor } }
          : {}),
        panes: {
          separatorColor: '#88888888',
        },
      },
      grid: {
        vertLines: { color: '#88888825' },
        horzLines: { color: '#88888825' },
      },
      localization: {
        timeFormatter: (time: Time) => formatLwcTime(time, timezone),
      },
      timeScale: {
        tickMarkFormatter: (time: Time, tickType: TickMarkType) =>
          formatLwcTick(time, tickType, timezone),
      },
    })

    chart.timeScale().applyOptions({
      borderColor: '#88888825',
      timeVisible: true,
    })

    chart.priceScale('right').applyOptions({
      borderColor: '#88888825',
      minimumWidth: 40,
    })
  }, [chartReady, chartRef, timezone, themeVersion])

  React.useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    if (mainSeriesRef.current) {
      try {
        chart.removeSeries(mainSeriesRef.current)
      } catch {
        // Ignore transient disposal races while the preview is re-rendering.
      }
    }

    const { seriesType, options } = buildSeriesOptions(resolvedCandleType, MARKET_PRICE_FORMAT)
    mainSeriesRef.current = chart.addSeries(seriesType, options) as MainSeries
  }, [chartReady, chartRef, mainSeriesRef, resolvedCandleType])

  React.useEffect(() => {
    const chart = chartRef.current
    const series = mainSeriesRef.current
    if (!chart || !series || seriesData.length === 0) return

    try {
      series.setData(seriesData as never)
    } catch {
      // Ignore transient disposal races while the preview is re-rendering.
    }
  }, [seriesData, chartReady, chartRef, mainSeriesRef])

  React.useEffect(() => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    if (!chart || !mainSeries) return

    const selectedIndicatorIds = new Set(indicators.map((indicator) => indicator.id))
    const nextRuntime = new Map<string, IndicatorRuntimeEntry>()
    const runtimeSignatureParts: string[] = []
    const pane = getPane(mainSeries)
    const paneIndex = getPaneIndex(mainSeries)

    // Track which pane index each non-overlay indicator should use
    const indicatorPaneMap = new Map<string, number>()
    let nextPaneIndex = chart.panes().length // next available pane index

    indicators.forEach((indicator, indicatorIndex) => {
      const existingSeriesMap = indicatorSeriesRefs.current.get(indicator.id) ?? new Map()
      indicatorSeriesRefs.current.set(indicator.id, existingSeriesMap)

      const outputSeries = indicator.output?.series ?? []
      // Check plot-level overlay — if all plots are overlay, indicator stays on main pane
      const isOverlay = outputSeries.length > 0 && outputSeries.every((s) => s.plot.overlay)
      const nextSeriesKeys = new Set<string>()
      const plots: IndicatorRuntimeEntry['plots'] = []
      let paneAnchorSeries: ISeriesApi<any> | null = null

      // Assign a pane index for non-overlay indicators
      let assignedPaneIndex: number | undefined
      if (!isOverlay && outputSeries.length > 0) {
        if (!indicatorPaneMap.has(indicator.id)) {
          indicatorPaneMap.set(indicator.id, nextPaneIndex)
          nextPaneIndex++
        }
        assignedPaneIndex = indicatorPaneMap.get(indicator.id)
      }

      outputSeries.forEach((entry, plotIndex) => {
        const title = entry.plot.title.trim() || `Series ${plotIndex + 1}`
        const key = `${indicator.id}:${title}:${plotIndex}`
        const seriesType = entry.plot.seriesType ?? 'Line'
        const color =
          entry.plot.color?.trim() ||
          INDICATOR_PALETTE[(indicatorIndex + plotIndex) % INDICATOR_PALETTE.length]
        nextSeriesKeys.add(key)

        const data = entry.points.flatMap((point) => {
          if (typeof point.value !== 'number' || !Number.isFinite(point.value)) return []

          const nextPoint: { time: number; value: number; color?: string } = {
            time: point.time,
            value: point.value,
          }

          if (typeof point.color === 'string' && point.color.trim().length > 0) {
            nextPoint.color = point.color.trim()
          } else if (seriesType === 'Histogram' && !entry.plot.color) {
            // Color histogram bars by candle direction (green up, red down)
            const isUp = barDirectionByTime.get(point.time)
            nextPoint.color = isUp === false ? '#F23645' : '#089981'
          }

          return [nextPoint]
        })

        // Resolve the series constructor based on the plot's seriesType
        const definition =
          seriesType === 'Histogram' ? HistogramSeries : seriesType === 'Area' ? AreaSeries : LineSeries

        const options = {
          color,
          ...(seriesType === 'Line' ? { lineWidth: 2 as const } : {}),
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          visible: indicator.visible,
        }

        let series = existingSeriesMap.get(key)
        if (!series) {
          // Use paneIndex param: 0 = main pane, higher = separate panes (auto-created)
          series = chart.addSeries(
            definition,
            options,
            isOverlay ? 0 : assignedPaneIndex
          )
          existingSeriesMap.set(key, series)
        } else {
          series.applyOptions({
            color,
            visible: indicator.visible,
          })
        }

        try {
          series.setData(data as never)
        } catch {
          // Ignore transient disposal races while the preview is re-rendering.
        }

        if (!isOverlay && !paneAnchorSeries) {
          paneAnchorSeries = series
        }

        plots.push({
          key,
          title,
          color,
          series,
        })
        runtimeSignatureParts.push(`${indicator.id}:${title}:${indicator.visible ? '1' : '0'}`)
      })

      existingSeriesMap.forEach((series, key) => {
        if (nextSeriesKeys.has(key)) return
        try {
          chart.removeSeries(series)
        } catch {
          // Ignore transient disposal races while the preview is re-rendering.
        }
        existingSeriesMap.delete(key)
      })

      // Resolve the actual pane and index for the runtime entry
      const anchorSeries = paneAnchorSeries ?? (plots[0]?.series as ISeriesApi<any> | undefined) ?? null
      let runtimePane = pane
      let runtimePaneIndex = paneIndex
      if (anchorSeries) {
        try {
          runtimePane = anchorSeries.getPane()
          runtimePaneIndex = runtimePane?.paneIndex() ?? paneIndex
        } catch {
          // Ignore — use main pane defaults
        }
      }

      if (plots.length > 0 || indicator.errorMessage) {
        nextRuntime.set(indicator.id, {
          id: indicator.id,
          pane: runtimePane,
          paneIndex: runtimePaneIndex,
          plots,
          paneAnchorSeries: anchorSeries ?? mainSeries,
          paneAnchorIdentity: `landing-${indicator.id}`,
          errorMessage: indicator.errorMessage,
        })
        runtimeSignatureParts.push(`${indicator.id}:error:${indicator.errorMessage ?? ''}`)
      }
    })

    indicatorSeriesRefs.current.forEach((seriesMap, indicatorId) => {
      if (selectedIndicatorIds.has(indicatorId)) return
      seriesMap.forEach((series) => {
        try {
          chart.removeSeries(series)
        } catch {
          // Ignore transient disposal races while the preview is re-rendering.
        }
      })
      indicatorSeriesRefs.current.delete(indicatorId)
    })

    // Render fills (e.g. Bollinger Bands shaded area)
    const activeFillKeys = new Set<string>()
    indicators.forEach((indicator) => {
      if (!indicator.output?.fills) return
      const fills = indicator.output.fills
      // Find the first overlay series for this indicator to attach fills to
      const anchorSeries = indicatorSeriesRefs.current.get(indicator.id)?.values().next().value ?? mainSeriesRef.current
      if (!anchorSeries) return

      fills.forEach((fill, fillIndex) => {
        const fillKey = `${indicator.id}:fill:${fillIndex}`
        activeFillKeys.add(fillKey)

        const existing = fillPrimitivesRef.current.get(fillKey)
        if (existing) {
          existing.update(fill)
          existing.setVisible(indicator.visible)
        } else {
          const created = createFillPrimitive(fill)
          try {
            ;(anchorSeries as any).attachPrimitive(created.primitive)
          } catch {
            // Ignore if attachPrimitive isn't available
            return
          }
          fillPrimitivesRef.current.set(fillKey, {
            series: anchorSeries,
            primitive: created.primitive,
            update: created.update,
            setVisible: created.setVisible,
          })
        }
      })
    })

    // Remove fills that are no longer active
    fillPrimitivesRef.current.forEach((attachment, key) => {
      if (activeFillKeys.has(key)) return
      attachment.setVisible(false)
      try {
        ;(attachment.series as any).detachPrimitive(attachment.primitive)
      } catch {
        // Ignore detach errors
      }
      fillPrimitivesRef.current.delete(key)
    })

    // Render markers (e.g. trigger signals) on the chart
    const markersBySeries = new Map<ISeriesApi<any>, SeriesMarker<any>[]>()
    indicators.forEach((indicator) => {
      if (!indicator.visible || !indicator.output?.markers) return
      indicator.output.markers.forEach((marker) => {
        const targetSeries = mainSeriesRef.current
        if (!targetSeries) return
        const isPricePosition =
          marker.position === 'atPriceTop' ||
          marker.position === 'atPriceBottom' ||
          marker.position === 'atPriceMiddle'
        const resolved: SeriesMarker<any> = {
          time: marker.time,
          position: marker.position,
          shape: marker.shape,
          color: marker.color ?? '#089981',
          text: marker.text,
          ...(isPricePosition && typeof marker.price === 'number' ? { price: marker.price } : {}),
        } as SeriesMarker<any>
        const list = markersBySeries.get(targetSeries) ?? []
        list.push(resolved)
        markersBySeries.set(targetSeries, list)
      })
    })

    // Sort markers by time and attach/update via createSeriesMarkers
    markersBySeries.forEach((markers, series) => {
      markers.sort((a, b) => (a.time as number) - (b.time as number))
      let plugin = seriesMarkersMapRef.current.get(series)
      if (!plugin) {
        plugin = createSeriesMarkers(series, markers)
        seriesMarkersMapRef.current.set(series, plugin)
      } else {
        plugin.setMarkers(markers)
      }
    })

    // Clear markers from series that no longer have any
    seriesMarkersMapRef.current.forEach((plugin, series) => {
      if (!markersBySeries.has(series)) {
        plugin.setMarkers([])
      }
    })

    indicatorRuntimeRef.current = nextRuntime
    const runtimeSignature = runtimeSignatureParts.join('|')
    if (runtimeSignature !== runtimeSignatureRef.current) {
      runtimeSignatureRef.current = runtimeSignature
      onIndicatorRuntimeChange?.()
    }
  }, [
    chartReady,
    chartRef,
    indicators,
    indicatorRuntimeRef,
    mainSeriesRef,
    onIndicatorRuntimeChange,
  ])

  return (
    <div
      ref={chartContainerCallbackRef}
      className={cn('landing-market-chart h-full w-full bg-background text-foreground', className)}
    />
  )
}
