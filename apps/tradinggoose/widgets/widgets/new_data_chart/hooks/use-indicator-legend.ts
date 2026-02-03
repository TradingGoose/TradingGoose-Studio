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
import type { DataChartViewParams, IndicatorRuntimeEntry } from '@/widgets/widgets/new_data_chart/types'

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
  dataVersion: number
  indicatorRuntimeVersion: number
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
    return entry ?? null
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
  dataVersion,
  indicatorRuntimeVersion,
}: UseIndicatorLegendArgs) => {
  const [legendMap, setLegendMap] = useState<Map<string, IndicatorPlotValue[]>>(new Map())
  const lastSignatureRef = useRef<string>('')

  const precision = useMemo(() => resolvePrecision(view?.pricePrecision), [view?.pricePrecision])

  const updateLegend = useCallback(
    (param?: MouseEventParams | null) => {
      const runtimeEntries = indicatorRuntimeRef.current
      if (!runtimeEntries || runtimeEntries.size === 0) {
        if (legendMap.size !== 0) {
          setLegendMap(new Map())
        }
        return
      }

      const nextMap = new Map<string, IndicatorPlotValue[]>()
      const signatureParts: string[] = []

      runtimeEntries.forEach((entry, indicatorId) => {
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
    [indicatorRuntimeRef, legendMap.size, precision]
  )

  useEffect(() => {
    updateLegend(null)
  }, [dataVersion, indicatorRuntimeVersion, updateLegend])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const handleCrosshairMove = (param: MouseEventParams) => {
      updateLegend(param)
    }

    chart.subscribeCrosshairMove(handleCrosshairMove)
    return () => chart.unsubscribeCrosshairMove(handleCrosshairMove)
  }, [chartRef, updateLegend])

  return legendMap
}
