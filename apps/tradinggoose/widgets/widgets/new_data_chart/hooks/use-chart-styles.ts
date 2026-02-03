'use client'

import { type MutableRefObject, useEffect, useRef } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
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
import { mapBarsMsToSeriesData } from '@/widgets/widgets/new_data_chart/series-data'
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

    const warnOnce = (message: string) => {
      if (warnedMessagesRef.current.has(message)) return
      warnedMessagesRef.current.add(message)
      console.warn(message)
    }

    const sanitizedOverrides = sanitizeStyleOverrides(
      (chartSettings?.stylesOverride as Record<string, unknown> | undefined) ?? undefined,
      warnOnce
    )

    const { localization: localizationOverride, timeScale: timeScaleOverride, ...chartOverrides } =
      sanitizedOverrides as Record<string, unknown>

    if (Object.keys(chartOverrides).length > 0) {
      chart.applyOptions(chartOverrides)
    }

    const { timezone, locale } = buildTimeFormatterConfig(chartSettings, seriesTimezone)
    const resolvedLocale = locale

    chart.applyOptions({
      localization: {
        ...(typeof localizationOverride === 'object' && localizationOverride ? localizationOverride : {}),
        ...(resolvedLocale ? { locale: resolvedLocale } : {}),
        timeFormatter: (time) => formatLwcTime(time, timezone, resolvedLocale),
      },
      timeScale: {
        ...(typeof timeScaleOverride === 'object' && timeScaleOverride ? timeScaleOverride : {}),
        timeVisible: true,
        tickMarkFormatter: (time, tickType) =>
          formatLwcTick(time, tickType, timezone, resolvedLocale),
      },
    })

    chart.timeScale().applyOptions({ rightOffset: DEFAULT_RIGHT_OFFSET })

    const candleType = resolveCandleType(chartSettings?.candleType)
    const precision = resolvePriceFormat(chartSettings?.pricePrecision).precision

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
      if (seriesData.length > 0) {
        mainSeriesRef.current.setData(seriesData as never)
      } else {
        mainSeriesRef.current.setData([] as never)
      }
    } else if (precisionChanged && mainSeriesRef.current) {
      const priceFormat = resolvePriceFormat(chartSettings?.pricePrecision)
      mainSeriesRef.current.applyOptions({ priceFormat: { type: 'price', ...priceFormat } })
    }

    lastCandleTypeRef.current = candleType
    lastPrecisionRef.current = precision

    const priceScaleMode = resolvePriceScaleMode(chartSettings?.priceAxisType)
    chart.priceScale('right').applyOptions({ mode: priceScaleMode })
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
    const isLineSeries = seriesType === 'Area' || seriesType === 'Line'
    const seriesData = mapBarsMsToSeriesData(
      dataContext.barsMsRef.current,
      isLineSeries ? 'area' : null
    )
    series.setData(seriesData as never)
  }, [chartSettings?.candleType, dataContext, dataVersion, mainSeriesRef, chartReady])
}
