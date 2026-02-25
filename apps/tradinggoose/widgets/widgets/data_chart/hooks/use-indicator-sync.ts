'use client'

import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'
import type { CanvasRenderingTarget2D } from 'fancy-canvas'
import {
  AreaSeries,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPaneApi,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type ISeriesPrimitive,
  LineSeries,
  LineType,
  type SeriesAttachedParameter,
  type SeriesMarker,
} from 'lightweight-charts'
import { getStableVibrantColor } from '@/lib/colors'
import { DEFAULT_INDICATOR_MAP } from '@/lib/indicators/default'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import type {
  IndicatorOptions,
  NormalizedPineMarker,
  NormalizedPineOutput,
} from '@/lib/indicators/types'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { IndicatorDefinition } from '@/stores/indicators/types'
import type {
  DataChartDataContext,
  IndicatorRef,
  IndicatorRuntimeEntry,
  IndicatorRuntimePlot,
} from '@/widgets/widgets/data_chart/types'
import {
  DEFAULT_DOWN_COLOR,
  DEFAULT_UP_COLOR,
} from '@/widgets/widgets/data_chart/utils/chart-styles'

const DEFAULT_PANE_HEIGHT_PX = 100
const EXECUTION_DEBOUNCE_MS = 0
const MAX_EXECUTION_CHUNK_BARS = 1200
const EXECUTION_CONTEXT_BARS = 300
const DEFAULT_PINE_LINE_WIDTH = 1

type MainSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'>

const isPriceMarkerPosition = (
  position: NormalizedPineMarker['position']
): position is 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle' =>
  position === 'atPriceTop' || position === 'atPriceBottom' || position === 'atPriceMiddle'

const toSeriesMarker = (marker: NormalizedPineMarker): SeriesMarker<number> | null => {
  const color = marker.color ?? DEFAULT_UP_COLOR
  if (isPriceMarkerPosition(marker.position)) {
    if (typeof marker.price !== 'number' || !Number.isFinite(marker.price)) {
      return null
    }
    return {
      time: marker.time,
      position: marker.position,
      shape: marker.shape,
      color,
      text: marker.text,
      price: marker.price,
    }
  }

  return {
    time: marker.time,
    position: marker.position,
    shape: marker.shape,
    color,
    text: marker.text,
  }
}

const normalizeEnumValue = (value?: string) => {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const normalized = trimmed.toLowerCase()
  return normalized.includes('.') ? normalized.split('.').pop() : normalized
}

const resolvePriceFormat = (format?: string, precision?: number) => {
  const normalizedFormat = normalizeEnumValue(format)
  const formatType =
    normalizedFormat === 'price' || normalizedFormat === 'volume' || normalizedFormat === 'percent'
      ? normalizedFormat
      : undefined
  const hasPrecision = typeof precision === 'number' && Number.isFinite(precision)
  if (!formatType && !hasPrecision) return null

  const resolvedPrecision = hasPrecision ? Math.max(0, Math.min(10, Math.round(precision))) : 2
  const minMove = 1 / 10 ** resolvedPrecision

  return {
    type: formatType ?? 'price',
    precision: resolvedPrecision,
    minMove,
  }
}

const resolveIndicatorFormat = (options?: IndicatorOptions) => {
  const direct = normalizeEnumValue(options?.format)
  if (direct) return direct
  const scale = normalizeEnumValue(options?.scale)
  if (scale === 'percent' || scale === 'volume') return scale
  return undefined
}

const resolveIndicatorScale = (options?: IndicatorOptions) => {
  const scale = normalizeEnumValue(options?.scale)
  if (scale === 'left' || scale === 'right' || scale === 'none') return scale
  return undefined
}

const isSeriesOnChart = (chart: IChartApi, series: ISeriesApi<any>) => {
  const panes = chart.panes()
  if (!panes.length) return false
  return panes.some((pane) => pane.getSeries().includes(series))
}

const safeRemoveSeries = (chart: IChartApi, series: ISeriesApi<any> | null) => {
  if (!series) return
  if (isSeriesOnChart(chart, series)) {
    chart.removeSeries(series)
  }
}

const detachSeriesMarkers = (
  seriesMarkersMap: Map<ISeriesApi<any>, ISeriesMarkersPluginApi<any>>,
  series: ISeriesApi<any>
) => {
  const markersPlugin = seriesMarkersMap.get(series)
  if (!markersPlugin) return
  markersPlugin.detach()
  seriesMarkersMap.delete(series)
}

const safeDetachPrimitive = (series: ISeriesApi<any>, primitive: ISeriesPrimitive<any>) => {
  const detachPrimitive =
    typeof (series as any).detachPrimitive === 'function'
      ? ((series as any).detachPrimitive as (primitive: ISeriesPrimitive<any>) => void)
      : null
  if (!detachPrimitive) return
  try {
    detachPrimitive(primitive)
  } catch {
    // Ignore detach errors when the underlying series has already been removed.
  }
}

const resolvePaneForSeries = (
  chart: IChartApi,
  seriesList: ISeriesApi<any>[],
  fallback: IPaneApi<any> | null
) => {
  const panes = chart.panes()
  if (fallback && panes.includes(fallback)) return fallback
  if (seriesList.length === 0) return null
  for (const pane of panes) {
    const paneSeries = pane.getSeries()
    for (const series of seriesList) {
      if (paneSeries.includes(series)) return pane
    }
  }
  return null
}

const collectExplicitColors = (plot: NormalizedPineOutput['series'][number]['plot']) => {
  const colors: string[] = []
  if (typeof plot.color === 'string' && plot.color.trim().length > 0) {
    colors.push(plot.color)
  }
  const options = plot.options ?? {}
  const optionColors = [options.color, options.lineColor, options.topColor]
  optionColors.forEach((value) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      colors.push(value)
    }
  })
  return colors
}

const resolveHistogramColors = () => ({
  up: DEFAULT_UP_COLOR,
  down: DEFAULT_DOWN_COLOR,
})

const resolvePlotColor = (plotKey: string) => getStableVibrantColor(plotKey)

type ExecuteResult = {
  indicatorId: string
  output: NormalizedPineOutput | null
  warnings: Array<{ code: string; message: string }>
  unsupported: { plots: string[]; styles: string[] }
  counts: { plots: number; markers: number; triggers: number }
  executionError?: { message: string; code?: string; unsupported?: { features: string[] } }
}

type ExecutionInput = {
  id: string
  inputsMap: Record<string, unknown>
  accumulationBase: string
}

type ProcessedRange = {
  startMs: number
  endMs: number
}

const resolveMissingChunk = (
  bars: DataChartDataContext['barsMsRef']['current'],
  range: ProcessedRange | undefined,
  maxBars: number
) => {
  if (bars.length === 0) return null
  if (!range) {
    const startIndex = Math.max(0, bars.length - maxBars)
    return bars.slice(startIndex)
  }
  const overlapBars = Math.max(0, Math.min(EXECUTION_CONTEXT_BARS, maxBars - 1))

  const firstOpenTime = bars[0]?.openTime
  const lastOpenTime = bars[bars.length - 1]?.openTime
  if (
    typeof firstOpenTime !== 'number' ||
    typeof lastOpenTime !== 'number' ||
    (range.startMs <= firstOpenTime && range.endMs >= lastOpenTime)
  ) {
    return null
  }

  const leftBoundaryIndex = bars.findIndex((bar) => bar.openTime >= range.startMs)
  const rightBoundaryIndex = bars.findIndex((bar) => bar.openTime > range.endMs)
  const leftBoundary = leftBoundaryIndex >= 0 ? leftBoundaryIndex : bars.length
  const rightBoundary = rightBoundaryIndex >= 0 ? rightBoundaryIndex : bars.length

  const missingLeftBars = Math.max(0, leftBoundary)
  const missingRightBars = Math.max(0, bars.length - rightBoundary)
  if (missingLeftBars <= 0 && missingRightBars <= 0) return null

  if (missingLeftBars >= missingRightBars && missingLeftBars > 0) {
    const endIndex = Math.min(bars.length, leftBoundary + overlapBars)
    const startIndex = Math.max(0, endIndex - maxBars)
    return bars.slice(startIndex, endIndex)
  }

  const startIndex = Math.max(0, rightBoundary - overlapBars)
  const endIndex = Math.min(bars.length, startIndex + maxBars)
  return bars.slice(startIndex, endIndex)
}

const resolveSeriesMergeKey = (entry: NormalizedPineOutput['series'][number], index: number) =>
  `${entry.plot.title ?? ''}:${index}`

const resolveFillMergeKey = (entry: NormalizedPineOutput['fills'][number], index: number) =>
  `${entry.title}:${entry.upperPlotTitle ?? ''}:${entry.lowerPlotTitle ?? ''}:${index}`

const mergeSeriesPoints = (
  existing: NormalizedPineOutput['series'][number]['points'],
  incoming: NormalizedPineOutput['series'][number]['points']
) => {
  const byTime = new Map<number, NormalizedPineOutput['series'][number]['points'][number]>()
  existing.forEach((point) => {
    byTime.set(point.time, point)
  })
  incoming.forEach((point) => {
    const previous = byTime.get(point.time)
    if (previous && point.value === null && previous.value !== null) return
    byTime.set(point.time, point)
  })
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time)
}

const mergeFillPoints = (
  existing: NormalizedPineOutput['fills'][number]['points'],
  incoming: NormalizedPineOutput['fills'][number]['points']
) => {
  const byTime = new Map<number, NormalizedPineOutput['fills'][number]['points'][number]>()
  existing.forEach((point) => {
    byTime.set(point.time, point)
  })
  incoming.forEach((point) => {
    byTime.set(point.time, point)
  })
  return Array.from(byTime.values()).sort((a, b) => a.time - b.time)
}

const mergeSeriesEntries = (
  existing: NormalizedPineOutput['series'],
  incoming: NormalizedPineOutput['series']
): NormalizedPineOutput['series'] => {
  const existingByKey = new Map<string, NormalizedPineOutput['series'][number]>()
  existing.forEach((entry, index) => {
    existingByKey.set(resolveSeriesMergeKey(entry, index), entry)
  })
  return incoming.map((entry, index) => {
    const previous = existingByKey.get(resolveSeriesMergeKey(entry, index))
    if (!previous) return entry
    return {
      ...entry,
      points: mergeSeriesPoints(previous.points, entry.points),
    }
  })
}

const mergeFillEntries = (
  existing: NormalizedPineOutput['fills'],
  incoming: NormalizedPineOutput['fills']
): NormalizedPineOutput['fills'] => {
  const existingByKey = new Map<string, NormalizedPineOutput['fills'][number]>()
  existing.forEach((entry, index) => {
    existingByKey.set(resolveFillMergeKey(entry, index), entry)
  })
  return incoming.map((entry, index) => {
    const previous = existingByKey.get(resolveFillMergeKey(entry, index))
    if (!previous) return entry
    return {
      ...entry,
      points: mergeFillPoints(previous.points, entry.points),
    }
  })
}

const mergeMarkers = (
  existing: NormalizedPineOutput['markers'],
  incoming: NormalizedPineOutput['markers'],
  replacedRange?: ProcessedRange
): NormalizedPineOutput['markers'] => {
  const existingMarkers =
    replacedRange && Number.isFinite(replacedRange.startMs) && Number.isFinite(replacedRange.endMs)
      ? (() => {
          const startSec = Math.floor(replacedRange.startMs / 1000)
          const endSec = Math.floor(replacedRange.endMs / 1000)
          return existing.filter((marker) => marker.time < startSec || marker.time > endSec)
        })()
      : existing

  const byKey = new Map<string, NormalizedPineOutput['markers'][number]>()
  const toKey = (marker: NormalizedPineOutput['markers'][number]) =>
    [
      marker.time,
      marker.source ?? '',
      marker.position,
      marker.shape,
      marker.text ?? '',
      marker.color ?? '',
      typeof marker.price === 'number' && Number.isFinite(marker.price) ? marker.price : '',
    ].join('|')

  existingMarkers.forEach((marker) => {
    byKey.set(toKey(marker), marker)
  })
  incoming.forEach((marker) => {
    byKey.set(toKey(marker), marker)
  })

  return Array.from(byKey.values()).sort((a, b) => a.time - b.time)
}

const mergeIndicatorOutput = (
  existing: NormalizedPineOutput,
  incoming: NormalizedPineOutput,
  replacedRange?: ProcessedRange
): NormalizedPineOutput => ({
  ...incoming,
  series: mergeSeriesEntries(existing.series, incoming.series),
  fills: mergeFillEntries(existing.fills, incoming.fills),
  markers: mergeMarkers(existing.markers, incoming.markers, replacedRange),
})

const buildInputsHash = (inputs: Record<string, unknown>) => {
  const sortedKeys = Object.keys(inputs).sort()
  const sorted: Record<string, unknown> = {}
  sortedKeys.forEach((key) => {
    sorted[key] = inputs[key]
  })
  return JSON.stringify(sorted)
}

const resolveSeriesDefinition = (seriesType?: string) => {
  if (seriesType === 'Histogram') return HistogramSeries
  if (seriesType === 'Area') return AreaSeries
  return LineSeries
}

const resolveSeriesOptions = (
  plot: NormalizedPineOutput['series'][number]['plot'],
  indicatorOptions?: IndicatorOptions,
  indicatorId?: string,
  overlay?: boolean
): Record<string, unknown> => {
  const options: Record<string, unknown> = { ...(plot.options ?? {}) }
  if (options.lineType === 'withSteps') {
    options.lineType = LineType.WithSteps
  }

  const resolvedSeriesType = plot.seriesType ?? 'Line'
  if (
    (resolvedSeriesType === 'Line' || resolvedSeriesType === 'Area') &&
    typeof options.lineWidth !== 'number'
  ) {
    options.lineWidth = DEFAULT_PINE_LINE_WIDTH
  }

  if (plot.seriesType === 'Line' && plot.color && !('color' in options)) {
    options.color = plot.color
  }
  if (plot.seriesType === 'Histogram' && plot.color && !('color' in options)) {
    options.color = plot.color
  }
  if (plot.seriesType === 'Area' && plot.color) {
    if (!('lineColor' in options)) {
      options.lineColor = plot.color
    }
    if (!('topColor' in options)) {
      options.topColor = plot.color
    }
    if (!('bottomColor' in options)) {
      options.bottomColor = 'transparent'
    }
  }

  const plotFormat = normalizeEnumValue(options.format as string | undefined)
  const plotPrecision =
    typeof options.precision === 'number' && Number.isFinite(options.precision)
      ? (options.precision as number)
      : undefined
  const indicatorFormat = resolveIndicatorFormat(indicatorOptions)
  const indicatorPrecision =
    typeof indicatorOptions?.precision === 'number' && Number.isFinite(indicatorOptions.precision)
      ? indicatorOptions.precision
      : undefined
  const priceFormat = resolvePriceFormat(
    plotFormat ?? indicatorFormat,
    plotPrecision ?? indicatorPrecision
  )
  if (priceFormat && !('priceFormat' in options)) {
    options.priceFormat = priceFormat
  }

  const scale = resolveIndicatorScale(indicatorOptions)
  if (scale === 'left' || scale === 'right') {
    if (!('priceScaleId' in options)) {
      options.priceScaleId = scale
    }
  } else if (scale === 'none') {
    if (overlay) {
      options.lastValueVisible = false
      options.priceLineVisible = false
    } else if (indicatorId && !('priceScaleId' in options)) {
      options.priceScaleId = `indicator:${indicatorId}:hidden`
    }
  }

  return options
}

const buildSeriesData = (
  seriesType: string | undefined,
  points: NormalizedPineOutput['series'][number]['points'],
  options?: {
    histogramColors?: { up: string; down: string } | null
    histogramColorMode?: 'value' | 'candle' | null
    barDirectionByTimeSec?: Map<number, boolean> | null
  }
) => {
  const histogramColors = options?.histogramColors ?? null
  const histogramColorMode = options?.histogramColorMode ?? null
  const barDirectionByTimeSec = options?.barDirectionByTimeSec ?? null
  let lastHistogramValue: number | null = null

  const seriesData: Array<{ time: number; value?: number; color?: string }> = []

  points.forEach((point) => {
    if (point.value === null) {
      seriesData.push({ time: point.time })
      return
    }
    if (seriesType === 'Histogram' || seriesType === 'Line') {
      let resolvedColor = point.color
      if (!resolvedColor && seriesType === 'Histogram' && histogramColors) {
        if (histogramColorMode === 'candle') {
          const isUp = barDirectionByTimeSec?.get(point.time)
          resolvedColor =
            typeof isUp === 'boolean'
              ? isUp
                ? histogramColors.up
                : histogramColors.down
              : histogramColors.up
        } else {
          const numericValue =
            typeof point.value === 'number' && Number.isFinite(point.value) ? point.value : null
          if (numericValue !== null) {
            resolvedColor =
              lastHistogramValue === null
                ? histogramColors.up
                : numericValue >= lastHistogramValue
                  ? histogramColors.up
                  : histogramColors.down
          }
        }
      }
      const entry = {
        time: point.time,
        value: point.value,
        ...(resolvedColor ? { color: resolvedColor } : null),
      }
      seriesData.push(entry)
      if (
        seriesType === 'Histogram' &&
        typeof point.value === 'number' &&
        Number.isFinite(point.value)
      ) {
        lastHistogramValue = point.value
      }
      return
    }
    seriesData.push({
      time: point.time,
      value: point.value,
    })
  })

  return seriesData
}

type IndicatorFill = NormalizedPineOutput['fills'][number]

type IndicatorFillRendererPoint = {
  x: number
  upper: number
  lower: number
}

type IndicatorFillViewData = {
  points: IndicatorFillRendererPoint[]
  topColor: string
  bottomColor: string
  visible: boolean
}

type FillPrimitiveAttachment = {
  series: ISeriesApi<any>
  primitive: ISeriesPrimitive<any>
  update: (fill: IndicatorFill) => void
  setVisible: (visible: boolean) => void
}

const createFillPrimitive = (
  initialFill: IndicatorFill
): Omit<FillPrimitiveAttachment, 'series'> => {
  const state: {
    attached: SeriesAttachedParameter<any, any> | null
    points: IndicatorFill['points']
    topColor: string
    bottomColor: string
    visible: boolean
  } = {
    attached: null,
    points: initialFill.points,
    topColor: initialFill.topColor,
    bottomColor: initialFill.bottomColor,
    visible: true,
  }

  const viewData: IndicatorFillViewData = {
    points: [],
    topColor: initialFill.topColor,
    bottomColor: initialFill.bottomColor,
    visible: true,
  }

  const updateView = () => {
    const attached = state.attached
    viewData.topColor = state.topColor
    viewData.bottomColor = state.bottomColor
    viewData.visible = state.visible
    if (!attached) {
      viewData.points = []
      return
    }

    const timeScale = attached.chart.timeScale()
    const nextPoints: IndicatorFillRendererPoint[] = []
    state.points.forEach((point) => {
      const x = timeScale.timeToCoordinate(point.time as any)
      const upper = attached.series.priceToCoordinate(point.upper)
      const lower = attached.series.priceToCoordinate(point.lower)
      if (
        typeof x !== 'number' ||
        !Number.isFinite(x) ||
        typeof upper !== 'number' ||
        !Number.isFinite(upper) ||
        typeof lower !== 'number' ||
        !Number.isFinite(lower)
      ) {
        return
      }
      nextPoints.push({ x, upper, lower })
    })

    viewData.points = nextPoints
  }

  const renderer: IPrimitivePaneRenderer = {
    draw() {},
    drawBackground(target: CanvasRenderingTarget2D) {
      target.useMediaCoordinateSpace(({ context }) => {
        if (!viewData.visible) return
        const points = viewData.points
        if (points.length < 2) return

        for (let i = 1; i < points.length; i += 1) {
          const previous = points[i - 1]
          const current = points[i]
          if (!previous || !current) continue

          const segment = new Path2D()
          segment.moveTo(previous.x, previous.upper)
          segment.lineTo(current.x, current.upper)
          segment.lineTo(current.x, current.lower)
          segment.lineTo(previous.x, previous.lower)
          segment.closePath()

          const upperMid = (previous.upper + current.upper) / 2
          const lowerMid = (previous.lower + current.lower) / 2
          const gradientEndY = lowerMid !== upperMid ? lowerMid : lowerMid + 1
          const gradient = context.createLinearGradient(0, upperMid, 0, gradientEndY)
          gradient.addColorStop(0, viewData.topColor)
          gradient.addColorStop(1, viewData.bottomColor)

          context.fillStyle = gradient
          context.fill(segment)
        }
      })
    },
  }

  const paneView: IPrimitivePaneView = {
    zOrder() {
      return 'bottom' as const
    },
    renderer() {
      return renderer
    },
  }
  const paneViews = [paneView] as const

  const primitive: ISeriesPrimitive<any> = {
    attached(attached) {
      state.attached = attached
      attached.requestUpdate()
    },
    detached() {
      state.attached = null
    },
    updateAllViews() {
      updateView()
    },
    paneViews() {
      return paneViews
    },
  }

  const update = (fill: IndicatorFill) => {
    state.points = fill.points
    state.topColor = fill.topColor
    state.bottomColor = fill.bottomColor
    state.visible = true
    state.attached?.requestUpdate()
  }

  const setVisible = (visible: boolean) => {
    state.visible = visible
    state.attached?.requestUpdate()
  }

  return {
    primitive,
    update,
    setVisible,
  }
}

export const useIndicatorSync = ({
  chartRef,
  mainSeriesRef,
  dataContext,
  workspaceId,
  indicatorRefs,
  indicators,
  listing,
  interval,
  chartReady,
  indicatorRuntimeRef,
  onIndicatorRuntimeChange,
}: {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<MainSeries | null>
  dataContext: DataChartDataContext
  workspaceId: string | null
  indicatorRefs: IndicatorRef[]
  indicators: IndicatorDefinition[]
  listing?: ListingIdentity | null
  interval?: string | null
  chartReady?: number
  indicatorRuntimeRef?: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  onIndicatorRuntimeChange?: () => void
}) => {
  const indicatorSeriesMapRef = useRef(new Map<string, Map<string, ISeriesApi<any>>>())
  const indicatorPaneMapRef = useRef(new Map<string, IPaneApi<any> | null>())
  const seriesIdentityMapRef = useRef(new WeakMap<ISeriesApi<any>, number>())
  const seriesIdentityCounterRef = useRef(1)
  const seriesMarkersMapRef = useRef(new Map<ISeriesApi<any>, ISeriesMarkersPluginApi<any>>())
  const indicatorFillPrimitiveMapRef = useRef(
    new Map<string, Map<string, FillPrimitiveAttachment>>()
  )
  const accumulatedOutputRef = useRef(new Map<string, NormalizedPineOutput>())
  const processedRangeRef = useRef(new Map<string, ProcessedRange>())
  const accumulationBaseRef = useRef(new Map<string, string>())
  const indicatorIdsRef = useRef<Set<string>>(new Set())
  const indicatorSignatureRef = useRef(new Map<string, string>())
  const warningCacheRef = useRef(new Set<string>())
  const runtimeSignatureRef = useRef<string>('')
  const runIdRef = useRef(0)

  const indicatorIds = useMemo(
    () => indicatorRefs.filter((ref) => ref && typeof ref.id === 'string').map((ref) => ref.id),
    [indicatorRefs]
  )

  const indicatorRefMap = useMemo(
    () => new Map(indicatorRefs.map((ref) => [ref.id, ref])),
    [indicatorRefs]
  )

  const indicatorMap = useMemo(
    () => new Map(indicators.map((indicator) => [indicator.id, indicator])),
    [indicators]
  )

  const executionContextKey = useMemo(() => {
    const listingKey = listing
      ? [listing.listing_type, listing.listing_id, listing.base_id, listing.quote_id].join('|')
      : 'none'
    return `${workspaceId ?? 'none'}|${listingKey}|${interval ?? 'none'}`
  }, [workspaceId, listing, interval])

  const warnOnce = (message: string) => {
    if (warningCacheRef.current.has(message)) return
    warningCacheRef.current.add(message)
    console.warn(message)
  }

  const getSeriesIdentity = (series: ISeriesApi<any> | null) => {
    if (!series) return 'none'
    const map = seriesIdentityMapRef.current
    const existing = map.get(series)
    if (existing !== undefined) return `s${existing}`
    const nextId = seriesIdentityCounterRef.current
    seriesIdentityCounterRef.current = nextId + 1
    map.set(series, nextId)
    return `s${nextId}`
  }

  const buildIndicatorSignature = (output: NormalizedPineOutput) =>
    output.series
      .map(
        (entry) =>
          `${entry.plot.title ?? ''}:${entry.plot.seriesType ?? 'Line'}:${
            entry.plot.overlay === false ? '0' : '1'
          }`
      )
      .join('|')

  const cleanupIndicator = (indicatorId: string) => {
    const chart = chartRef.current
    if (!chart) return

    const fillPrimitiveMap = indicatorFillPrimitiveMapRef.current.get(indicatorId)
    if (fillPrimitiveMap) {
      fillPrimitiveMap.forEach(({ series, primitive, setVisible }) => {
        setVisible(false)
        safeDetachPrimitive(series, primitive)
      })
      indicatorFillPrimitiveMapRef.current.delete(indicatorId)
    }

    const seriesMap = indicatorSeriesMapRef.current.get(indicatorId)
    const seriesList = seriesMap ? Array.from(seriesMap.values()) : []
    const pane = resolvePaneForSeries(
      chart,
      seriesList,
      indicatorPaneMapRef.current.get(indicatorId) ?? null
    )
    const mainSeries = mainSeriesRef.current
    if (pane && typeof chart.removePane === 'function') {
      const panes = chart.panes()
      const paneIndex = panes.indexOf(pane)
      if (panes.length > 1 && paneIndex >= 0) {
        const mainPane = mainSeries?.getPane()
        if (pane !== mainPane) {
          chart.removePane(paneIndex)
        }
      }
    }

    if (seriesMap) {
      seriesMap.forEach((series) => {
        detachSeriesMarkers(seriesMarkersMapRef.current, series)
        safeRemoveSeries(chart, series)
      })
      indicatorSeriesMapRef.current.delete(indicatorId)
    }
    indicatorPaneMapRef.current.delete(indicatorId)
    indicatorSignatureRef.current.delete(indicatorId)
    accumulatedOutputRef.current.delete(indicatorId)
    processedRangeRef.current.delete(indicatorId)
    accumulationBaseRef.current.delete(indicatorId)
  }

  useEffect(() => {
    accumulatedOutputRef.current.clear()
    processedRangeRef.current.clear()
    accumulationBaseRef.current.clear()
  }, [executionContextKey])

  useEffect(() => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    if (!chart || !mainSeries) return
    if (!workspaceId) return

    indicatorFillPrimitiveMapRef.current.forEach((fillPrimitiveMap, indicatorId) => {
      const visible = indicatorRefMap.get(indicatorId)?.visible !== false
      fillPrimitiveMap.forEach((attachment) => {
        attachment.setVisible(visible)
      })
    })

    const runId = (runIdRef.current += 1)
    const clearIndicatorRuntime = () => {
      if (!indicatorRuntimeRef) return
      indicatorRuntimeRef.current = new Map()
      if (runtimeSignatureRef.current !== '') {
        runtimeSignatureRef.current = ''
        onIndicatorRuntimeChange?.()
      }
    }

    const activeIds = new Set(indicatorIds)
    const previousIds = indicatorIdsRef.current
    previousIds.forEach((id) => {
      if (!activeIds.has(id)) {
        cleanupIndicator(id)
      }
    })
    indicatorIdsRef.current = activeIds

    if (indicatorIds.length === 0) {
      clearIndicatorRuntime()
      return
    }
    if (dataContext.barsMsRef.current.length === 0) {
      activeIds.forEach((id) => cleanupIndicator(id))
      clearIndicatorRuntime()
      return
    }

    const executionBars = dataContext.barsMsRef.current
    if (executionBars.length === 0) return

    const indicatorInputs: ExecutionInput[] = []
    indicatorIds.forEach((id) => {
      const indicator = indicatorMap.get(id)
      const defaultIndicator = DEFAULT_INDICATOR_MAP.get(id)
      if (!indicator && !defaultIndicator) return
      const inputMeta = indicator?.inputMeta ?? defaultIndicator?.inputMeta
      const inputsMap = buildInputsMapFromMeta(
        inputMeta ?? undefined,
        indicatorRefMap.get(id)?.inputs
      )
      const inputsHash = buildInputsHash(inputsMap)
      const indicatorVersion = indicator?.updatedAt ?? indicator?.createdAt ?? 'default'
      indicatorInputs.push({
        id,
        inputsMap,
        accumulationBase: `${id}:${indicatorVersion}:${inputsHash}`,
      })
    })

    if (indicatorInputs.length === 0) return

    indicatorInputs.forEach((entry) => {
      const previousBase = accumulationBaseRef.current.get(entry.id)
      if (previousBase !== entry.accumulationBase) {
        accumulationBaseRef.current.set(entry.id, entry.accumulationBase)
        accumulatedOutputRef.current.delete(entry.id)
        processedRangeRef.current.delete(entry.id)
      }
    })

    const barDirectionByTimeSec = new Map<number, boolean>()
    let previousClose: number | null = null
    executionBars.forEach((bar) => {
      const isUp =
        typeof previousClose === 'number' ? bar.close >= previousClose : bar.close >= bar.open
      barDirectionByTimeSec.set(Math.floor(bar.openTime / 1000), isUp)
      previousClose = bar.close
    })

    const controller = new AbortController()
    const debounceHandle = window.setTimeout(async () => {
      const executionGroups = new Map<
        string,
        { bars: typeof executionBars; inputs: ExecutionInput[] }
      >()
      const executedRangeById = new Map<string, ProcessedRange>()
      indicatorInputs.forEach((entry) => {
        const chunk = resolveMissingChunk(
          executionBars,
          processedRangeRef.current.get(entry.id),
          MAX_EXECUTION_CHUNK_BARS
        )
        if (!chunk || chunk.length === 0) return
        const startMs = chunk[0]!.openTime
        const endMs = chunk[chunk.length - 1]!.openTime
        const key = `${startMs}:${endMs}:${chunk.length}`
        const existing = executionGroups.get(key)
        if (existing) {
          existing.inputs.push(entry)
        } else {
          executionGroups.set(key, {
            bars: chunk,
            inputs: [entry],
          })
        }
        executedRangeById.set(entry.id, { startMs, endMs })
      })

      const resultById = new Map<string, ExecuteResult>()
      const executionErrorById = new Map<string, string>()

      await Promise.all(
        Array.from(executionGroups.values()).map(async (group) => {
          if (controller.signal.aborted || runId !== runIdRef.current) return
          try {
            const marketSeries = {
              listing: listing ?? undefined,
              bars: group.bars.map((bar) => ({
                timeStamp: new Date(bar.openTime).toISOString(),
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
                volume: bar.volume,
                turnover: bar.turnover,
              })),
            }

            const response = await fetch('/api/indicators/execute', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                workspaceId,
                indicatorIds: group.inputs.map((item) => item.id),
                marketSeries,
                inputsMapById: group.inputs.reduce<Record<string, Record<string, unknown>>>(
                  (acc, item) => {
                    acc[item.id] = item.inputsMap
                    return acc
                  },
                  {}
                ),
                interval: interval ?? undefined,
                intervalMs: dataContext.intervalMs ?? undefined,
              }),
            })

            const payload = await response.json().catch(() => ({}))
            if (!response.ok || !payload?.success) {
              warnOnce(payload?.error || 'Failed to execute indicators')
            } else if (Array.isArray(payload?.data)) {
              ;(payload.data as ExecuteResult[]).forEach((result) => {
                resultById.set(result.indicatorId, result)
              })
            }
          } catch (error) {
            if ((error as Error).name !== 'AbortError') {
              warnOnce(error instanceof Error ? error.message : 'Failed to execute indicators')
            }
          }
        })
      )

      if (controller.signal.aborted || runId !== runIdRef.current) {
        return
      }

      const extendProcessedRange = (indicatorId: string, range?: ProcessedRange) => {
        if (!range) return
        const previous = processedRangeRef.current.get(indicatorId)
        if (!previous) {
          processedRangeRef.current.set(indicatorId, range)
          return
        }
        processedRangeRef.current.set(indicatorId, {
          startMs: Math.min(previous.startMs, range.startMs),
          endMs: Math.max(previous.endMs, range.endMs),
        })
      }

      resultById.forEach((result, indicatorId) => {
        if (!result.output) {
          const errorMessage = result.executionError?.message?.trim()
          if (errorMessage) {
            executionErrorById.set(indicatorId, errorMessage)
          }
          return
        }
        if (result.warnings?.length) {
          result.warnings.forEach((warning) => warnOnce(warning.message))
        }
        const existingOutput = accumulatedOutputRef.current.get(indicatorId)
        const executedRange = executedRangeById.get(indicatorId)
        const nextOutput = existingOutput
          ? mergeIndicatorOutput(existingOutput, result.output, executedRange)
          : result.output
        accumulatedOutputRef.current.set(indicatorId, nextOutput)
        extendProcessedRange(indicatorId, executedRange)
      })

      const markerEntries: Array<{
        series: ISeriesApi<any>
        marker: SeriesMarker<any>
      }> = []

      const runtimeEntries = new Map<string, IndicatorRuntimeEntry>()
      const mainPane = mainSeries.getPane()
      const mainPaneIndex = mainPane.paneIndex()

      indicatorIds.forEach((indicatorId) => {
        if (!indicatorIdsRef.current.has(indicatorId)) {
          cleanupIndicator(indicatorId)
          return
        }
        const errorMessage = executionErrorById.get(indicatorId)
        const output = accumulatedOutputRef.current.get(indicatorId)
        if (!output) {
          if (errorMessage) warnOnce(errorMessage)
          cleanupIndicator(indicatorId)
          if (errorMessage) {
            runtimeEntries.set(indicatorId, {
              id: indicatorId,
              pane: null,
              paneIndex: mainPaneIndex,
              plots: [],
              paneAnchorSeries: null,
              paneAnchorIdentity: null,
              errorMessage,
            })
          }
          return
        }
        if (errorMessage) warnOnce(errorMessage)
        const indicatorOptions = output.indicator
        const indicatorScale = resolveIndicatorScale(indicatorOptions)
        const signature = buildIndicatorSignature(output)
        const previousSignature = indicatorSignatureRef.current.get(indicatorId)
        const shouldRebuild = previousSignature !== signature
        if (shouldRebuild) {
          const preservedAccumulationBase = accumulationBaseRef.current.get(indicatorId)
          const preservedRange = processedRangeRef.current.get(indicatorId)
          cleanupIndicator(indicatorId)
          indicatorSignatureRef.current.set(indicatorId, signature)
          accumulatedOutputRef.current.set(indicatorId, output)
          if (preservedAccumulationBase) {
            accumulationBaseRef.current.set(indicatorId, preservedAccumulationBase)
          }
          if (preservedRange) {
            processedRangeRef.current.set(indicatorId, preservedRange)
          }
        }

        const hasNonOverlay = output.series.some((plot) => plot.plot.overlay === false)
        const shouldApplyBehindChart = indicatorOptions?.behind_chart === true && !hasNonOverlay
        const shouldApplyExplicitOrder = indicatorOptions?.explicit_plot_zorder === true
        const mainSeriesOrder = !hasNonOverlay && mainSeries ? mainSeries.seriesOrder() : 0
        const baseSeriesOrder = shouldApplyBehindChart
          ? 0
          : !hasNonOverlay
            ? mainSeriesOrder + 1
            : 0
        const existingSeriesMap = indicatorSeriesMapRef.current.get(indicatorId)
        let pane: IPaneApi<any> | null = indicatorPaneMapRef.current.get(indicatorId) ?? null
        if (pane && !chart.panes().includes(pane)) {
          pane = resolvePaneForSeries(
            chart,
            existingSeriesMap ? Array.from(existingSeriesMap.values()) : [],
            null
          )
        }
        if (hasNonOverlay) {
          if (!pane) {
            if (typeof chart.addPane === 'function') {
              pane = chart.addPane()
              pane.setHeight(DEFAULT_PANE_HEIGHT_PX)
            } else {
              warnOnce('chart.addPane is unavailable; falling back to overlay plots.')
            }
          }
        } else if (pane) {
          cleanupIndicator(indicatorId)
          pane = null
        }
        indicatorPaneMapRef.current.set(indicatorId, pane)

        const seriesMap = existingSeriesMap ?? new Map<string, ISeriesApi<any>>()
        indicatorSeriesMapRef.current.set(indicatorId, seriesMap)
        const fillPrimitiveMap =
          indicatorFillPrimitiveMapRef.current.get(indicatorId) ??
          new Map<string, FillPrimitiveAttachment>()
        indicatorFillPrimitiveMapRef.current.set(indicatorId, fillPrimitiveMap)

        let paneAnchorSeries: ISeriesApi<any> | null = null
        const nextSeriesKeys = new Set<string>()
        const nextFillKeys = new Set<string>()
        const runtimePlots: IndicatorRuntimePlot[] = []
        const indicatorVisible = indicatorRefMap.get(indicatorId)?.visible !== false

        output.series.forEach((seriesEntry, plotIndex) => {
          const seriesType = seriesEntry.plot.seriesType ?? 'Line'
          const targetPane = seriesEntry.plot.overlay === false ? pane : null
          const definition = resolveSeriesDefinition(seriesType)
          const plotKey = `${indicatorId}:${seriesEntry.plot.title ?? ''}`
          const seriesKey = seriesEntry.plot.title ?? ''
          const explicitColors = collectExplicitColors(seriesEntry.plot)
          const histogramColors =
            seriesType === 'Histogram' && explicitColors.length === 0
              ? resolveHistogramColors()
              : null
          const histogramColorMode =
            seriesType === 'Histogram' && histogramColors
              ? seriesEntry.points.some(
                  (point) => typeof point.value === 'number' && point.value < 0
                )
                ? 'value'
                : 'candle'
              : null
          const resolvedPlot =
            explicitColors.length === 0 && seriesType !== 'Histogram'
              ? {
                  ...seriesEntry.plot,
                  color: resolvePlotColor(plotKey),
                }
              : seriesEntry.plot
          const options = resolveSeriesOptions(
            resolvedPlot,
            indicatorOptions,
            indicatorId,
            seriesEntry.plot.overlay !== false
          )
          const legendColor = (() => {
            const optionColor =
              (options.color as string | undefined) ??
              (options.lineColor as string | undefined) ??
              (options.topColor as string | undefined)
            if (typeof optionColor === 'string' && optionColor.trim().length > 0) {
              return optionColor
            }
            if (typeof resolvedPlot.color === 'string' && resolvedPlot.color.trim().length > 0) {
              return resolvedPlot.color
            }
            if (histogramColors?.up) return histogramColors.up
            return undefined
          })()
          let series = seriesMap.get(seriesKey) ?? null
          const existingType =
            series && typeof series.seriesType === 'function' ? series.seriesType() : null
          const needsNewSeries = !series || (existingType && existingType !== seriesType)
          if (needsNewSeries) {
            if (series) {
              detachSeriesMarkers(seriesMarkersMapRef.current, series)
              safeRemoveSeries(chart, series)
              seriesMap.delete(seriesKey)
            }
            series = targetPane
              ? targetPane.addSeries(definition, options)
              : chart.addSeries(definition, options)
            seriesMap.set(seriesKey, series)
          } else if (series && typeof (series as any).applyOptions === 'function') {
            ;(series as any).applyOptions(options)
          }

          if (series && indicatorScale === 'none' && seriesEntry.plot.overlay === false) {
            series.priceScale().applyOptions({ visible: false })
          }

          if (series && (shouldApplyExplicitOrder || shouldApplyBehindChart)) {
            series.setSeriesOrder(baseSeriesOrder + plotIndex)
          }

          if (!series) return
          series.setData(
            buildSeriesData(seriesType, seriesEntry.points, {
              histogramColors,
              histogramColorMode,
              barDirectionByTimeSec,
            }) as any
          )
          nextSeriesKeys.add(seriesKey)
          runtimePlots.push({
            key: plotKey || `${indicatorId}-${plotIndex}`,
            title: seriesEntry.plot.title?.trim() || `Plot ${plotIndex + 1}`,
            color: legendColor,
            series,
          })

          if (!seriesEntry.plot.overlay && !paneAnchorSeries) {
            paneAnchorSeries = series
          }
        })

        seriesMap.forEach((series, key) => {
          if (key === '__anchor__') return
          if (!nextSeriesKeys.has(key)) {
            detachSeriesMarkers(seriesMarkersMapRef.current, series)
            safeRemoveSeries(chart, series)
            seriesMap.delete(key)
          }
        })

        if (pane && !paneAnchorSeries) {
          const anchorKey = '__anchor__'
          let anchorSeries = seriesMap.get(anchorKey) ?? null
          if (!anchorSeries) {
            anchorSeries = pane.addSeries(LineSeries, {
              color: 'transparent',
              lineWidth: 1,
              priceLineVisible: false,
              lastValueVisible: false,
            })
            seriesMap.set(anchorKey, anchorSeries)
          }
          const openTimes = dataContext.openTimeMsByIndexRef.current
          anchorSeries.setData(
            openTimes.map((timeMs) => ({ time: Math.floor(timeMs / 1000) })) as any
          )
          paneAnchorSeries = anchorSeries
        } else if (!pane && seriesMap.has('__anchor__')) {
          const anchor = seriesMap.get('__anchor__')
          if (anchor) {
            detachSeriesMarkers(seriesMarkersMapRef.current, anchor)
            safeRemoveSeries(chart, anchor)
          }
          seriesMap.delete('__anchor__')
        }

        const paneAnchorIdentity = paneAnchorSeries ? getSeriesIdentity(paneAnchorSeries) : null
        if (indicatorVisible) {
          const fillEntries = Array.isArray(output.fills) ? output.fills : []
          fillEntries.forEach((fillEntry, fillIndex) => {
            const fillKey = resolveFillMergeKey(fillEntry, fillIndex)
            nextFillKeys.add(fillKey)

            const anchorSeries =
              (fillEntry.upperPlotTitle ? seriesMap.get(fillEntry.upperPlotTitle) : null) ??
              (fillEntry.lowerPlotTitle ? seriesMap.get(fillEntry.lowerPlotTitle) : null) ??
              (hasNonOverlay ? paneAnchorSeries : mainSeries)

            if (!anchorSeries) {
              warnOnce(`Fill ${fillEntry.title} skipped because no anchor series was found.`)
              return
            }
            if (!Array.isArray(fillEntry.points) || fillEntry.points.length < 2) {
              return
            }

            const existingAttachment = fillPrimitiveMap.get(fillKey)
            if (existingAttachment && existingAttachment.series !== anchorSeries) {
              safeDetachPrimitive(existingAttachment.series, existingAttachment.primitive)
              fillPrimitiveMap.delete(fillKey)
            }

            let attachment = fillPrimitiveMap.get(fillKey)
            if (!attachment) {
              const created = createFillPrimitive(fillEntry)
              anchorSeries.attachPrimitive(created.primitive)
              attachment = {
                series: anchorSeries,
                primitive: created.primitive,
                update: created.update,
                setVisible: created.setVisible,
              }
              fillPrimitiveMap.set(fillKey, attachment)
            }
            attachment.update(fillEntry)
          })
        }

        fillPrimitiveMap.forEach((attachment, fillKey) => {
          if (!indicatorVisible) {
            attachment.setVisible(false)
            return
          }
          if (nextFillKeys.has(fillKey)) return
          safeDetachPrimitive(attachment.series, attachment.primitive)
          fillPrimitiveMap.delete(fillKey)
        })
        if (indicatorVisible && fillPrimitiveMap.size === 0) {
          indicatorFillPrimitiveMapRef.current.delete(indicatorId)
        }

        output.markers.forEach((marker) => {
          const targetSeries = !indicatorVisible
            ? null
            : marker.source === 'trigger'
              ? mainSeries
              : hasNonOverlay
                ? paneAnchorSeries
                : mainSeries
          if (!targetSeries) return
          const resolvedMarker = toSeriesMarker(marker)
          if (!resolvedMarker) return
          markerEntries.push({ series: targetSeries, marker: resolvedMarker })
        })

        runtimeEntries.set(indicatorId, {
          id: indicatorId,
          pane,
          paneIndex: pane ? pane.paneIndex() : mainPaneIndex,
          plots: runtimePlots,
          paneAnchorSeries,
          paneAnchorIdentity,
        })
      })

      const markersBySeries = new Map<ISeriesApi<any>, SeriesMarker<any>[]>()
      markerEntries.forEach(({ series, marker }) => {
        const list = markersBySeries.get(series) ?? []
        list.push(marker)
        markersBySeries.set(series, list)
      })
      markersBySeries.forEach((markers) => {
        // lightweight-charts expects series markers to be sorted by time.
        markers.sort((a, b) => a.time - b.time)
      })

      markersBySeries.forEach((markers, series) => {
        let plugin = seriesMarkersMapRef.current.get(series)
        if (!plugin) {
          plugin = createSeriesMarkers(series, markers)
          seriesMarkersMapRef.current.set(series, plugin)
        } else {
          plugin.setMarkers(markers)
        }
      })

      seriesMarkersMapRef.current.forEach((plugin, series) => {
        if (!markersBySeries.has(series)) {
          plugin.setMarkers([])
        }
      })

      if (indicatorRuntimeRef) {
        indicatorRuntimeRef.current = runtimeEntries
        const signature = Array.from(runtimeEntries.values())
          .map((entry) => {
            const plotKeys = entry.plots.map((plot) => plot.key).join(',')
            const anchorIdentity = entry.paneAnchorIdentity ?? 'none'
            const errorTag = entry.errorMessage ? `:error:${entry.errorMessage}` : ''
            return `${entry.id}:${entry.paneIndex}:${plotKeys}:anchor:${anchorIdentity}${errorTag}`
          })
          .join('|')
        if (signature !== runtimeSignatureRef.current) {
          runtimeSignatureRef.current = signature
          onIndicatorRuntimeChange?.()
        }
      }

      const panes = chart.panes()
      if (panes.length > 1) {
        const mainPane = mainSeries.getPane()
        const referencedPanes = new Set<IPaneApi<any>>()
        indicatorPaneMapRef.current.forEach((pane) => {
          if (pane) referencedPanes.add(pane)
        })

        const removablePanes = panes
          .filter(
            (pane) =>
              pane !== mainPane && !referencedPanes.has(pane) && pane.getSeries().length === 0
          )
          .sort((a, b) => b.paneIndex() - a.paneIndex())

        removablePanes.forEach((pane) => {
          const currentPanes = chart.panes()
          const paneIndex = currentPanes.indexOf(pane)
          if (currentPanes.length > 1 && paneIndex >= 0) {
            chart.removePane(paneIndex)
          }
        })
      }
    }, EXECUTION_DEBOUNCE_MS)

    return () => {
      controller.abort()
      window.clearTimeout(debounceHandle)
    }
  }, [
    chartRef,
    mainSeriesRef,
    dataContext,
    dataContext.dataVersion,
    dataContext.intervalMs,
    workspaceId,
    indicatorIds,
    indicatorMap,
    indicatorRefMap,
    listing,
    interval,
    chartReady,
    indicatorRuntimeRef,
    onIndicatorRuntimeChange,
  ])
}
