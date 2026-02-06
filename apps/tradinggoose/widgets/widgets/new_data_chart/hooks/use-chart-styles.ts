'use client'

import { type MutableRefObject, useEffect, useRef } from 'react'
import type { IChartApi, ISeriesApi, TickMarkType, Time } from 'lightweight-charts'
import type { DataChartViewParams } from '@/widgets/widgets/new_data_chart/types'
import {
  buildSeriesOptions,
  buildTimeFormatterConfig,
  DEFAULT_RIGHT_OFFSET,
  formatLwcTick,
  formatLwcTime,
  resolveCandleType,
  resolvePriceScaleMode,
  sanitizeStyleOverrides,
} from '@/widgets/widgets/new_data_chart/utils/chart-styles'
import {
  findFirstInvalidSeriesDatum,
  mapBarsMsToSeriesData,
  sanitizeSeriesData,
} from '@/widgets/widgets/new_data_chart/series-data'
import type { NewDataChartDataContext } from '@/widgets/widgets/new_data_chart/types'

type UseChartStylesArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  mainSeriesRef: MutableRefObject<
    ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'> | null
  >
  chartSettings?: DataChartViewParams
  seriesTimezone: string | null
  themeVersion: number
  dataContext: NewDataChartDataContext
  dataVersion: number
  chartReady: number
}

const resolvePriceFormat = (precision?: number | null) => {
  const resolvedPrecision = typeof precision === 'number' && Number.isFinite(precision)
    ? Math.max(0, Math.floor(precision))
    : 2
  return {
    precision: resolvedPrecision,
    minMove: 1 / Math.pow(10, resolvedPrecision),
  }
}

const buildCompactPriceFormatter = (precision: number, locale?: string) => {
  const formatter = new Intl.NumberFormat(locale || undefined, {
    maximumFractionDigits: precision,
    minimumFractionDigits: 0,
    useGrouping: false,
  })
  const thresholds = [
    { value: 1_000_000_000_000, suffix: 'T' },
    { value: 1_000_000_000, suffix: 'B' },
    { value: 1_000_000, suffix: 'M' },
    { value: 1_000, suffix: 'K' },
  ]

  return (value: number) => {
    if (!Number.isFinite(value)) return ''
    const absValue = Math.abs(value)
    const match = thresholds.find((entry) => absValue >= entry.value)
    if (!match) {
      return formatter.format(value)
    }
    const scaledValue = value / match.value
    return `${formatter.format(scaledValue)}${match.suffix}`
  }
}

export const useChartStyles = ({
  chartRef,
  chartContainerRef,
  mainSeriesRef,
  chartSettings,
  seriesTimezone,
  themeVersion,
  dataContext,
  dataVersion,
  chartReady,
}: UseChartStylesArgs) => {
  const lastCandleTypeRef = useRef<string | null>(null)
  const lastPrecisionRef = useRef<number | null>(null)
  const warnedMessagesRef = useRef<Set<string>>(new Set())

  const warnOnce = (message: string, payload?: Record<string, unknown>) => {
    if (warnedMessagesRef.current.has(message)) return
    warnedMessagesRef.current.add(message)
    if (payload) {
      console.warn(message, payload)
    } else {
      console.warn(message)
    }
  }

  const applySeriesData = (
    series: ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'> | ISeriesApi<'Area'>,
    data: ReturnType<typeof mapBarsMsToSeriesData>,
    candleType: DataChartViewParams['candleType'] | null,
    context: string
  ) => {
    const sanitized = sanitizeSeriesData(data, candleType)
    if (sanitized.length !== data.length) {
      const invalid = findFirstInvalidSeriesDatum(data, candleType)
      warnOnce('[new_data_chart] Dropped invalid series data', {
        context,
        dropped: data.length - sanitized.length,
        sample: invalid?.entry ?? null,
        error: invalid?.error ?? null,
        index: invalid?.index ?? null,
      })
    }
    try {
      series.setData(sanitized as never)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[new_data_chart] Failed to set series data', { context, message })
      series.setData([] as never)
    }
  }

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const container = chartContainerRef.current
    const computedStyles = container ? window.getComputedStyle(container) : null
    const fontFamily = computedStyles?.fontFamily?.trim() ?? ''
    const textColor = computedStyles?.color?.trim() ?? ''
    const backgroundColor = computedStyles?.backgroundColor?.trim() ?? ''

    chart.applyOptions({
      layout: {
        ...(fontFamily ? { fontFamily } : {}),
        ...(textColor ? { textColor } : {}),
        ...(backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? { background: { color: backgroundColor } }
          : {}),
        panes: { separatorColor: '#ffab0088' },
      },
      grid: {
        vertLines: { color: '#88888825' },
        horzLines: { color: '#88888825' },
      },
    })

    const sanitizedOverrides = sanitizeStyleOverrides(
      (chartSettings?.stylesOverride as Record<string, unknown> | undefined) ?? undefined,
      (message) => warnOnce(message)
    )

    const { localization: localizationOverride, timeScale: timeScaleOverride, ...chartOverrides } =
      sanitizedOverrides as Record<string, unknown>

    if (Object.keys(chartOverrides).length > 0) {
      chart.applyOptions(chartOverrides)
    }

    const { timezone, locale } = buildTimeFormatterConfig(chartSettings, seriesTimezone)
    const resolvedLocale = locale
    const precision = resolvePriceFormat(chartSettings?.pricePrecision).precision
    const hasPriceFormatterOverride =
      typeof localizationOverride === 'object' &&
      localizationOverride !== null &&
      'priceFormatter' in localizationOverride
    const priceFormatter = hasPriceFormatterOverride
      ? undefined
      : buildCompactPriceFormatter(precision, resolvedLocale)

    chart.applyOptions({
      localization: {
        ...(typeof localizationOverride === 'object' && localizationOverride ? localizationOverride : {}),
        ...(resolvedLocale ? { locale: resolvedLocale } : {}),
        ...(priceFormatter ? { priceFormatter } : {}),
        timeFormatter: (time: Time) => formatLwcTime(time, timezone, resolvedLocale),
      },
      timeScale: {
        ...(typeof timeScaleOverride === 'object' && timeScaleOverride ? timeScaleOverride : {}),
        timeVisible: true,
        tickMarkFormatter: (time: Time, tickType: TickMarkType) =>
          formatLwcTick(time, tickType, timezone, resolvedLocale),
      },
    })

    chart.timeScale().applyOptions({ rightOffset: DEFAULT_RIGHT_OFFSET })

    const candleType = resolveCandleType(chartSettings?.candleType)

    const candleTypeChanged = lastCandleTypeRef.current !== candleType
    const precisionChanged = lastPrecisionRef.current !== precision

    if (candleTypeChanged || !mainSeriesRef.current) {
      if (mainSeriesRef.current) {
        chart.removeSeries(mainSeriesRef.current)
      }

      const priceFormat = resolvePriceFormat(chartSettings?.pricePrecision)
      const { seriesType, options } = buildSeriesOptions(candleType, priceFormat)
      mainSeriesRef.current = chart.addSeries(seriesType, options) as
        | ISeriesApi<'Candlestick'>
        | ISeriesApi<'Bar'>
        | ISeriesApi<'Area'>

      const seriesData = mapBarsMsToSeriesData(dataContext.barsMsRef.current, candleType)
      applySeriesData(mainSeriesRef.current, seriesData, candleType, 'initSeries')
    } else if (precisionChanged && mainSeriesRef.current) {
      const priceFormat = resolvePriceFormat(chartSettings?.pricePrecision)
      mainSeriesRef.current.applyOptions({ priceFormat: { type: 'price' as const, ...priceFormat } })
    }

    lastCandleTypeRef.current = candleType
    lastPrecisionRef.current = precision

    const priceScaleMode = resolvePriceScaleMode(chartSettings?.priceAxisType)
    chart.priceScale('right').applyOptions({ mode: priceScaleMode, minimumWidth: 40 })
  }, [
    chartRef,
    chartContainerRef,
    chartSettings,
    seriesTimezone,
    themeVersion,
    dataContext,
    mainSeriesRef,
    chartReady,
  ])

  useEffect(() => {
    const series = mainSeriesRef.current
    if (!series) return
    const seriesType = series.seriesType()
    const isAreaSeries = seriesType === 'Area'
    const seriesData = mapBarsMsToSeriesData(
      dataContext.barsMsRef.current,
      isAreaSeries ? 'area' : null
    )
    applySeriesData(series, seriesData, isAreaSeries ? 'area' : null, 'refreshSeries')
  }, [chartSettings?.candleType, dataContext, dataVersion, mainSeriesRef, chartReady])
}
