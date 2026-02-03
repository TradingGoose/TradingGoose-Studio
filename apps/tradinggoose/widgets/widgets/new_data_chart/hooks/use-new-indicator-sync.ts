'use client'

import { type MutableRefObject, useEffect, useMemo, useRef } from 'react'
import {
  AreaSeries,
  createSeriesMarkers,
  HistogramSeries,
  type IChartApi,
  type IPaneApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  LineSeries,
  LineType,
  type SeriesMarker,
} from 'lightweight-charts'
import { getStableVibrantColor } from '@/lib/colors'
import { DEFAULT_PINE_INDICATOR_MAP } from '@/lib/new_indicators/default'
import { buildInputsMapFromMeta } from '@/lib/new_indicators/input-meta'
import type { NormalizedPineOutput } from '@/lib/new_indicators/types'
import type { NewIndicatorDefinition } from '@/stores/new-indicators/types'
import type {
  IndicatorRuntimeEntry,
  IndicatorRuntimePlot,
  NewDataChartDataContext,
  NewIndicatorRef,
} from '@/widgets/widgets/new_data_chart/types'
import {
  DEFAULT_DOWN_COLOR,
  DEFAULT_UP_COLOR,
} from '@/widgets/widgets/new_data_chart/utils/chart-styles'

const DEFAULT_PANE_HEIGHT_PX = 100
const MAX_MARKERS_TOTAL = 2000
const MAX_BARS = 2000
const EXECUTION_DEBOUNCE_MS = 300
const DEFAULT_PINE_LINE_WIDTH = 1

type MainSeries = ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'>

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
  counts: { plots: number; markers: number; drawings: number; signals: number }
  executionError?: { message: string; code?: string; unsupported?: { features: string[] } }
}

type CacheEntry = {
  key: string
  result: ExecuteResult
}

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
  plot: NormalizedPineOutput['series'][number]['plot']
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

export const useNewIndicatorSync = ({
  chartRef,
  mainSeriesRef,
  dataContext,
  workspaceId,
  indicatorRefs,
  indicators,
  listingKey,
  interval,
  chartReady,
  indicatorRuntimeRef,
  onIndicatorRuntimeChange,
}: {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<MainSeries | null>
  dataContext: NewDataChartDataContext
  workspaceId: string | null
  indicatorRefs: NewIndicatorRef[]
  indicators: NewIndicatorDefinition[]
  listingKey?: string | null
  interval?: string | null
  chartReady?: number
  indicatorRuntimeRef?: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  onIndicatorRuntimeChange?: () => void
}) => {
  const indicatorSeriesMapRef = useRef(new Map<string, Map<string, ISeriesApi<any>>>())
  const indicatorPaneMapRef = useRef(new Map<string, IPaneApi<any> | null>())
  const indicatorPaneSeriesMapRef = useRef(new Map<string, ISeriesApi<any> | null>())
  const seriesMarkersMapRef = useRef(new Map<ISeriesApi<any>, ISeriesMarkersPluginApi<any>>())
  const cacheRef = useRef(new Map<string, CacheEntry>())
  const indicatorIdsRef = useRef<Set<string>>(new Set())
  const indicatorSignatureRef = useRef(new Map<string, string>())
  const warningCacheRef = useRef(new Set<string>())
  const runtimeSignatureRef = useRef<string>('')

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

  const warnOnce = (message: string) => {
    if (warningCacheRef.current.has(message)) return
    warningCacheRef.current.add(message)
    console.warn(message)
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

    const seriesMap = indicatorSeriesMapRef.current.get(indicatorId)
    const indicatorSeries = seriesMap ? Array.from(seriesMap.values()) : []
    if (seriesMap) {
      seriesMap.forEach((series) => {
        const markersPlugin = seriesMarkersMapRef.current.get(series)
        if (markersPlugin) {
          markersPlugin.detach()
          seriesMarkersMapRef.current.delete(series)
        }
        chart.removeSeries(series)
      })
      indicatorSeriesMapRef.current.delete(indicatorId)
    }

    const pane = indicatorPaneMapRef.current.get(indicatorId)
    if (pane && typeof chart.removePane === 'function') {
      const panes = chart.panes()
      if (panes.length > 1) {
        const paneSeries = pane.getSeries()
        const mainSeries = mainSeriesRef.current
        const hasMainSeries = mainSeries
          ? paneSeries.includes(mainSeries as unknown as ISeriesApi<any>)
          : false
        const hasOtherIndicator = Array.from(indicatorPaneMapRef.current.entries()).some(
          ([id, entryPane]) => id !== indicatorId && entryPane === pane
        )
        if (!hasMainSeries && !hasOtherIndicator) {
          // Remove any remaining series in this pane to ensure it can be dropped immediately.
          paneSeries.forEach((series) => {
            const markersPlugin = seriesMarkersMapRef.current.get(series)
            if (markersPlugin) {
              markersPlugin.detach()
              seriesMarkersMapRef.current.delete(series)
            }
            chart.removeSeries(series)
          })
          const nextPanes = chart.panes()
          const paneIndex = nextPanes.findIndex((entry) => entry === pane)
          if (paneIndex >= 0 && nextPanes.length > 1) {
            chart.removePane(paneIndex)
          }
        }
      }
    }
    indicatorPaneMapRef.current.delete(indicatorId)
    indicatorPaneSeriesMapRef.current.delete(indicatorId)
    indicatorSignatureRef.current.delete(indicatorId)
  }

  useEffect(() => {
    const chart = chartRef.current
    const mainSeries = mainSeriesRef.current
    if (!chart || !mainSeries) return
    if (!workspaceId) return

    const activeIds = new Set(indicatorIds)
    const previousIds = indicatorIdsRef.current
    previousIds.forEach((id) => {
      if (!activeIds.has(id)) {
        cleanupIndicator(id)
      }
    })
    indicatorIdsRef.current = activeIds

    if (indicatorIds.length === 0) {
      if (indicatorRuntimeRef) {
        indicatorRuntimeRef.current = new Map()
        if (runtimeSignatureRef.current !== '') {
          runtimeSignatureRef.current = ''
          onIndicatorRuntimeChange?.()
        }
      }
      return
    }
    if (dataContext.barsMsRef.current.length === 0) {
      activeIds.forEach((id) => cleanupIndicator(id))
      if (indicatorRuntimeRef) {
        indicatorRuntimeRef.current = new Map()
        if (runtimeSignatureRef.current !== '') {
          runtimeSignatureRef.current = ''
          onIndicatorRuntimeChange?.()
        }
      }
      return
    }

    const barsMs = dataContext.barsMsRef.current
    const barsWereTruncated = barsMs.length > MAX_BARS
    const truncatedBars = barsWereTruncated ? barsMs.slice(-MAX_BARS) : barsMs
    const barDirectionByTimeSec = new Map<number, boolean>()
    let previousClose: number | null = null
    truncatedBars.forEach((bar) => {
      const isUp =
        typeof previousClose === 'number' ? bar.close >= previousClose : bar.close >= bar.open
      barDirectionByTimeSec.set(Math.floor(bar.openTime / 1000), isUp)
      previousClose = bar.close
    })

    const indicatorInputs = indicatorIds
      .map((id) => {
        const indicator = indicatorMap.get(id)
        const defaultIndicator = DEFAULT_PINE_INDICATOR_MAP.get(id)
        if (!indicator && !defaultIndicator) return null
        const inputMeta = indicator?.inputMeta ?? defaultIndicator?.inputMeta
        const inputsMap = buildInputsMapFromMeta(
          inputMeta ?? undefined,
          indicatorRefMap.get(id)?.inputs
        )
        const inputsHash = buildInputsHash(inputsMap)
        const indicatorVersion = indicator?.updatedAt ?? indicator?.createdAt ?? 'default'
        const cacheKey = `${id}:${indicatorVersion}:${dataContext.dataVersion}:${inputsHash}`
        return { id, inputsMap, inputsHash, cacheKey }
      })
      .filter(
        (
          entry
        ): entry is {
          id: string
          inputsMap: Record<string, unknown>
          inputsHash: string
          cacheKey: string
        } => Boolean(entry)
      )

    if (indicatorInputs.length === 0) return

    const cachedResults: ExecuteResult[] = []
    const indicatorsToExecute: Array<{
      id: string
      inputsMap: Record<string, unknown>
      cacheKey: string
    }> = []

    indicatorInputs.forEach(({ id, inputsMap, cacheKey }) => {
      const cached = cacheRef.current.get(cacheKey)
      if (cached) {
        cachedResults.push(cached.result)
        return
      }
      indicatorsToExecute.push({ id, inputsMap, cacheKey })
    })

    const controller = new AbortController()
    const debounceHandle = window.setTimeout(async () => {
      let fetchedResults: ExecuteResult[] = []

      if (indicatorsToExecute.length > 0) {
        try {
          const response = await fetch('/api/new_indicators/execute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
              workspaceId,
              indicatorIds: indicatorsToExecute.map((item) => item.id),
              barsMs: truncatedBars,
              inputsMapById: indicatorsToExecute.reduce<Record<string, Record<string, unknown>>>(
                (acc, item) => {
                  acc[item.id] = item.inputsMap
                  return acc
                },
                {}
              ),
              listingKey: listingKey ?? undefined,
              interval: interval ?? undefined,
              intervalMs: dataContext.intervalMs ?? undefined,
            }),
          })

          const payload = await response.json().catch(() => ({}))
          if (!response.ok || !payload?.success) {
            warnOnce(payload?.error || 'Failed to execute pine indicators')
          } else if (Array.isArray(payload?.data)) {
            fetchedResults = payload.data as ExecuteResult[]
            fetchedResults.forEach((result) => {
              const cachedInput = indicatorInputs.find((entry) => entry.id === result.indicatorId)
              if (cachedInput) {
                cacheRef.current.set(cachedInput.cacheKey, {
                  key: cachedInput.cacheKey,
                  result,
                })
              }
            })
          }
        } catch (error) {
          if ((error as Error).name !== 'AbortError') {
            warnOnce(error instanceof Error ? error.message : 'Failed to execute pine indicators')
          }
        }
      }

      const results = [...cachedResults, ...fetchedResults]
      const resultMap = new Map(results.map((result) => [result.indicatorId, result]))

      const markerEntries: Array<{
        series: ISeriesApi<any>
        marker: SeriesMarker<any>
      }> = []

      const runtimeEntries = new Map<string, IndicatorRuntimeEntry>()

      indicatorIds.forEach((indicatorId) => {
        const result = resultMap.get(indicatorId)
        if (!result || !result.output) {
          if (result?.executionError?.message) {
            warnOnce(result.executionError.message)
          }
          cleanupIndicator(indicatorId)
          return
        }

        const output = result.output
        const signature = buildIndicatorSignature(output)
        const previousSignature = indicatorSignatureRef.current.get(indicatorId)
        const shouldRebuild = previousSignature !== signature
        if (shouldRebuild) {
          cleanupIndicator(indicatorId)
          indicatorSignatureRef.current.set(indicatorId, signature)
        }
        if (result.warnings?.length) {
          result.warnings.forEach((warning) => warnOnce(warning.message))
        }

        const hasNonOverlay = output.series.some((plot) => plot.plot.overlay === false)
        let pane: IPaneApi<any> | null = indicatorPaneMapRef.current.get(indicatorId) ?? null
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

        const seriesMap =
          indicatorSeriesMapRef.current.get(indicatorId) ?? new Map<string, ISeriesApi<any>>()
        indicatorSeriesMapRef.current.set(indicatorId, seriesMap)

        let paneAnchorSeries: ISeriesApi<any> | null = null
        const nextSeriesKeys = new Set<string>()
        const runtimePlots: IndicatorRuntimePlot[] = []

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
          const options = resolveSeriesOptions(resolvedPlot)
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
          const existingType = series && typeof series.seriesType === 'function' ? series.seriesType() : null
          const needsNewSeries = !series || (existingType && existingType !== seriesType)
          if (needsNewSeries) {
            if (series) {
              const markersPlugin = seriesMarkersMapRef.current.get(series)
              if (markersPlugin) {
                markersPlugin.detach()
                seriesMarkersMapRef.current.delete(series)
              }
              chart.removeSeries(series)
              seriesMap.delete(seriesKey)
            }
            series = targetPane
              ? targetPane.addSeries(definition, options)
              : chart.addSeries(definition, options)
            seriesMap.set(seriesKey, series)
          } else if (series && typeof (series as any).applyOptions === 'function') {
            ;(series as any).applyOptions(options)
          }

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
            const markersPlugin = seriesMarkersMapRef.current.get(series)
            if (markersPlugin) {
              markersPlugin.detach()
              seriesMarkersMapRef.current.delete(series)
            }
            chart.removeSeries(series)
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
            const markersPlugin = seriesMarkersMapRef.current.get(anchor)
            if (markersPlugin) {
              markersPlugin.detach()
              seriesMarkersMapRef.current.delete(anchor)
            }
            chart.removeSeries(anchor)
          }
          seriesMap.delete('__anchor__')
        }

        indicatorPaneSeriesMapRef.current.set(indicatorId, paneAnchorSeries)

        output.markers.forEach((marker) => {
          const targetSeries = hasNonOverlay ? paneAnchorSeries : mainSeries
          if (!targetSeries) return
          markerEntries.push({ series: targetSeries, marker })
        })

        if (runtimePlots.length > 0) {
          runtimeEntries.set(indicatorId, {
            id: indicatorId,
            pane,
            paneIndex: pane ? pane.paneIndex() : 0,
            plots: runtimePlots,
          })
        }
      })

      if (markerEntries.length > MAX_MARKERS_TOTAL) {
        markerEntries.sort((a, b) => a.marker.time - b.marker.time)
        const truncatedCount = markerEntries.length - MAX_MARKERS_TOTAL
        markerEntries.splice(0, truncatedCount)
        warnOnce(`Markers truncated to ${MAX_MARKERS_TOTAL} entries.`)
      }

      const markersBySeries = new Map<ISeriesApi<any>, SeriesMarker<any>[]>()
      markerEntries.forEach(({ series, marker }) => {
        const list = markersBySeries.get(series) ?? []
        list.push(marker)
        markersBySeries.set(series, list)
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
            return `${entry.id}:${entry.paneIndex}:${plotKeys}`
          })
          .join('|')
        if (signature !== runtimeSignatureRef.current) {
          runtimeSignatureRef.current = signature
          onIndicatorRuntimeChange?.()
        }
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
    listingKey,
    interval,
    chartReady,
    indicatorRuntimeRef,
    onIndicatorRuntimeChange,
  ])
}
