'use client'

import { useEffect, useRef } from 'react'
import { type Chart, dispose, init } from 'klinecharts'
import { ensureSignalOverlayRegistered } from '@/widgets/widgets/data_chart/components/body/signal-overlay'

export const useChartInstance = () => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<Chart | null>(null)

  useEffect(() => {
    if (!chartContainerRef.current) return
    if (chartRef.current) return
    ensureSignalOverlayRegistered()
    const chart = init(chartContainerRef.current)
    if (!chart) return
    chartRef.current = chart

    const resizeObserver = new ResizeObserver(() => {
      chart.resize()
    })
    resizeObserver.observe(chartContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      dispose(chart)
      chartRef.current = null
    }
  }, [])

  return { chartRef, chartContainerRef }
}
