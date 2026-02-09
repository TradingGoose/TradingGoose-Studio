'use client'

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BarData,
  CandlestickData,
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  WhitespaceData,
} from 'lightweight-charts'
import {
  buildTimeFormatterConfig,
  formatLwcTime,
} from '@/widgets/widgets/data_chart/utils/chart-styles'
import type { DataChartViewParams, DataChartDataContext } from '@/widgets/widgets/data_chart/types'

type MainSeries =
  | ISeriesApi<'Candlestick'>
  | ISeriesApi<'Bar'>
  | ISeriesApi<'Area'>

export type LegendData = {
  time: string
  open?: string
  high?: string
  low?: string
  close?: string
  value?: string
  change?: string
  direction?: 'up' | 'down' | 'flat'
}

type UseChartLegendArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<MainSeries | null>
  dataContext: DataChartDataContext
  seriesTimezone: string | null
  view?: DataChartViewParams
  chartReady: number
}

const resolvePrecision = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }
  return 2
}

const isOhlcData = (
  data: CandlestickData<Time> | BarData<Time> | WhitespaceData<Time>
): data is CandlestickData<Time> | BarData<Time> =>
  Boolean(data) && typeof data === 'object' && 'open' in data && 'high' in data && 'low' in data && 'close' in data

const isLineData = (
  data: LineData<Time> | WhitespaceData<Time>
): data is LineData<Time> =>
  Boolean(data) && typeof data === 'object' && 'value' in data

const resolveTimeLabel = (time: Time | null | undefined, timezone: string, locale?: string) => {
  if (!time) return ''
  return formatLwcTime(time, timezone, locale)
}

const buildChange = (open: number, close: number, precision: number) => {
  const decreased = close < open
  const increased = close > open
  const direction: LegendData['direction'] = decreased ? 'down' : increased ? 'up' : 'flat'
  const diff = close - open
  const diffAbs = Math.abs(diff)
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
  const change =
    open !== 0
      ? `${sign}${diffAbs.toFixed(precision)} (${sign}${((diffAbs / open) * 100).toFixed(2)}%)`
      : `${sign}${diffAbs.toFixed(precision)}`

  return { change, direction }
}

const buildOhlcLegend = (
  data: CandlestickData<Time> | BarData<Time>,
  timeLabel: string,
  precision: number
): LegendData => {
  const open = data.open
  const close = data.close
  const high = data.high
  const low = data.low
  const { change, direction } = buildChange(open, close, precision)

  return {
    time: timeLabel,
    open: open.toFixed(precision),
    high: high.toFixed(precision),
    low: low.toFixed(precision),
    close: close.toFixed(precision),
    change,
    direction,
  }
}

const buildLineLegend = (
  data: LineData<Time>,
  timeLabel: string,
  precision: number,
  bar?: { open: number; close: number } | null
): LegendData => {
  const value = typeof bar?.close === 'number' ? bar.close : data.value
  const changeInfo =
    bar && Number.isFinite(bar.open) && Number.isFinite(bar.close)
      ? buildChange(bar.open, bar.close, precision)
      : null

  return {
    time: timeLabel,
    value: value.toFixed(precision),
    ...(changeInfo ?? {}),
  }
}

const resolveLogicalIndex = (param: MouseEventParams | null | undefined) => {
  if (!param) return null
  const logical = (param as { logical?: number }).logical
  if (typeof logical !== 'number' || !Number.isFinite(logical)) return null
  return Math.round(logical)
}

const resolveBarAtIndex = (dataContext: DataChartDataContext, index?: number | null) => {
  const bars = dataContext.barsMsRef.current
  if (!bars.length) return null
  if (typeof index !== 'number' || !Number.isFinite(index)) {
    return bars[bars.length - 1] ?? null
  }
  const clampedIndex = Math.max(0, Math.min(bars.length - 1, Math.round(index)))
  return bars[clampedIndex] ?? null
}

export const useChartLegend = ({
  chartRef,
  mainSeriesRef,
  dataContext,
  seriesTimezone,
  view,
  chartReady,
}: UseChartLegendArgs): LegendData | null => {
  const [legendData, setLegendData] = useState<LegendData | null>(null)
  const lastKeyRef = useRef<string | null>(null)

  const precision = useMemo(() => resolvePrecision(view?.pricePrecision), [view?.pricePrecision])
  const { timezone, locale } = useMemo(
    () =>
      buildTimeFormatterConfig(
        { locale: view?.locale, timezone: view?.timezone } as DataChartViewParams,
        seriesTimezone
      ),
    [seriesTimezone, view?.locale, view?.timezone]
  )

  const setLegendIfChanged = useCallback((next: LegendData | null) => {
    const key = next
      ? `${next.time}|${next.open ?? ''}|${next.high ?? ''}|${next.low ?? ''}|${next.close ?? ''}|${next.value ?? ''
      }|${next.change ?? ''}`
      : 'none'
    if (lastKeyRef.current === key) return
    lastKeyRef.current = key
    setLegendData(next)
  }, [])

  const resolveLegendFromData = useCallback(
    (
      data: CandlestickData<Time> | BarData<Time> | LineData<Time> | WhitespaceData<Time>,
      fallbackTime?: Time | null,
      logicalIndex?: number | null
    ) => {
      const timeValue = 'time' in data ? data.time : fallbackTime
      const timeLabel = resolveTimeLabel(timeValue, timezone, locale)
      if (!timeLabel) return null

      if (isOhlcData(data)) {
        return buildOhlcLegend(data, timeLabel, precision)
      }
      if (isLineData(data)) {
        const bar = resolveBarAtIndex(dataContext, logicalIndex)
        return buildLineLegend(data, timeLabel, precision, bar)
      }
      return null
    },
    [dataContext, locale, precision, timezone]
  )

  const resolveLatestLegend = useCallback(() => {
    const series = mainSeriesRef.current
    if (!series) return null
    const latestData = series.dataByIndex(Number.MAX_SAFE_INTEGER, -1) as
      | CandlestickData<Time>
      | BarData<Time>
      | LineData<Time>
      | WhitespaceData<Time>
      | null
    if (!latestData) return null
    const fallbackIndex = dataContext.barsMsRef.current.length - 1
    return resolveLegendFromData(latestData, 'time' in latestData ? latestData.time : null, fallbackIndex)
  }, [dataContext, mainSeriesRef, resolveLegendFromData])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handleCrosshairMove = (param: MouseEventParams) => {
      const series = mainSeriesRef.current
      if (!series || !param?.time) {
        setLegendIfChanged(resolveLatestLegend())
        return
      }
      const seriesData = param.seriesData.get(series) as
        | CandlestickData<Time>
        | BarData<Time>
        | LineData<Time>
        | WhitespaceData<Time>
        | undefined
      if (!seriesData) {
        setLegendIfChanged(resolveLatestLegend())
        return
      }
      const logicalIndex = resolveLogicalIndex(param)
      const nextLegend = resolveLegendFromData(seriesData, param.time, logicalIndex)
      setLegendIfChanged(nextLegend)
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove)
  }, [
    chartRef,
    mainSeriesRef,
    resolveLatestLegend,
    resolveLegendFromData,
    setLegendIfChanged,
    chartReady,
  ])

  useEffect(() => {
    setLegendIfChanged(resolveLatestLegend())
  }, [dataContext.dataVersion, resolveLatestLegend, setLegendIfChanged])

  return legendData
}
