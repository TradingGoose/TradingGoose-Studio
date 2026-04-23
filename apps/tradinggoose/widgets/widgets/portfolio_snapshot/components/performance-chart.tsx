'use client'

import { useEffect, useMemo, useRef } from 'react'
import { AreaSeries, type ISeriesApi } from 'lightweight-charts'
import type { UnifiedTradingPortfolioPerformancePoint } from '@/providers/trading/types'
import { useChartInstance } from '@/widgets/widgets/data_chart/hooks/use-chart-instance'

const toChartTime = (timestamp: string) => {
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.floor(parsed / 1000)
}

export function PortfolioSnapshotPerformanceChart({
  series,
}: {
  series: UnifiedTradingPortfolioPerformancePoint[]
}) {
  const { chartRef, chartContainerCallbackRef, registerBeforeDestroy, chartReady } =
    useChartInstance(series.at(-1)?.timestamp ?? 'portfolio-snapshot-chart')
  const areaSeriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  const chartData = useMemo(
    () =>
      series
        .map((point) => {
          const time = toChartTime(point.timestamp)
          if (time == null) return null
          return {
            time,
            value: point.equity,
          }
        })
        .filter((point): point is { time: number; value: number } => point !== null),
    [series]
  )

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || chartReady === 0) {
      return
    }

    if (!areaSeriesRef.current) {
      areaSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: '#16a34a',
        topColor: 'rgba(22, 163, 74, 0.24)',
        bottomColor: 'rgba(22, 163, 74, 0.02)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
    }

    areaSeriesRef.current.setData(chartData as any)

    if (chartData.length > 0) {
      chart.timeScale().fitContent()
    }

    chart.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: {
        top: 0.18,
        bottom: 0.12,
      },
    })

    registerBeforeDestroy(() => {
      if (areaSeriesRef.current) {
        chart.removeSeries(areaSeriesRef.current)
        areaSeriesRef.current = null
      }
    })
  }, [chartData, chartReady, chartRef, registerBeforeDestroy])

  return <div ref={chartContainerCallbackRef} className='h-full w-full' />
}
