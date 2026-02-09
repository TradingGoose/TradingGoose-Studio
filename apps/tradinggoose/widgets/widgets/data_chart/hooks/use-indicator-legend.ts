'use client'

import { type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  IChartApi,
  ISeriesApi,
  LineData,
  MouseEventParams,
  Time,
  WhitespaceData,
} from 'lightweight-charts'
import type { DataChartViewParams, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

export type IndicatorPlotValue = {
  key: string
  title: string
  color?: string
  value: number | null
  displayValue: string
}

type UseIndicatorLegendArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  view?: DataChartViewParams
  chartReady: number
  dataVersion: number
  runtimeVersion: number
}

const resolvePrecision = (value?: number | null) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }
  return 2
}

const extractValue = (
  data: LineData<Time> | WhitespaceData<Time> | null | undefined
): number | null => {
  if (!data || typeof data !== 'object') return null
  if ('value' in data && typeof data.value === 'number' && Number.isFinite(data.value)) {
    return data.value
  }
  if ('close' in data && typeof data.close === 'number' && Number.isFinite(data.close)) {
    return data.close
  }
  return null
}

const resolveSeriesData = (
  series: ISeriesApi<any>,
  param?: MouseEventParams | null
): LineData<Time> | WhitespaceData<Time> | null => {
  if (param?.time) {
    const entry = param.seriesData.get(series) as
      | LineData<Time>
      | WhitespaceData<Time>
      | undefined
    if (entry) return entry
  }
  return series.dataByIndex(Number.MAX_SAFE_INTEGER, -1) as
    | LineData<Time>
    | WhitespaceData<Time>
    | null
}

export const useIndicatorLegend = ({
  chartRef,
  indicatorRuntimeRef,
  view,
  chartReady,
  dataVersion,
  runtimeVersion,
}: UseIndicatorLegendArgs) => {
  const [legendMap, setLegendMap] = useState<Map<string, IndicatorPlotValue[]>>(new Map())
  const lastSignatureRef = useRef<string>('')

  const precision = useMemo(() => resolvePrecision(view?.pricePrecision), [view?.pricePrecision])

  const updateLegend = useCallback(
    (param?: MouseEventParams | null) => {
      const runtimeEntries = indicatorRuntimeRef.current
      if (!runtimeEntries || runtimeEntries.size === 0) {
        if (lastSignatureRef.current !== '') {
          lastSignatureRef.current = ''
          setLegendMap(new Map())
        }
        return
      }

      const nextMap = new Map<string, IndicatorPlotValue[]>()
      const signatureParts: string[] = []

      runtimeEntries.forEach((entry, indicatorId) => {
        signatureParts.push(`${indicatorId}:count:${entry.plots.length}`)
        const values = entry.plots.map((plot) => {
          const data = resolveSeriesData(plot.series, param)
          const value = extractValue(data)
          const displayValue =
            typeof value === 'number' && Number.isFinite(value) ? value.toFixed(precision) : '--'
          signatureParts.push(`${indicatorId}:${plot.key}:${displayValue}`)
          return {
            key: plot.key,
            title: plot.title,
            color: plot.color,
            value,
            displayValue,
          }
        })
        nextMap.set(indicatorId, values)
      })

      const signature = signatureParts.join('|')
      if (signature === lastSignatureRef.current) return
      lastSignatureRef.current = signature
      setLegendMap(nextMap)
    },
    [indicatorRuntimeRef, precision]
  )

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handleCrosshairMove = (param: MouseEventParams) => {
      updateLegend(param)
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove)
  }, [chartRef, updateLegend, chartReady])

  useEffect(() => {
    updateLegend(null)
  }, [updateLegend, chartReady, dataVersion, runtimeVersion])

  return legendMap
}
