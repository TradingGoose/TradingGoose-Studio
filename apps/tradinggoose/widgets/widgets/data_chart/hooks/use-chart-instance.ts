'use client'

import { useEffect, useRef, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { DEFAULT_RIGHT_OFFSET } from '@/widgets/widgets/data_chart/utils/chart-styles'

export const useChartInstance = (resetKey?: string | number) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  type MainSeries =
    | ISeriesApi<'Candlestick'>
    | ISeriesApi<'Bar'>
    | ISeriesApi<'Area'>
  const mainSeriesRef = useRef<MainSeries | null>(null)
  const [chartReady, setChartReady] = useState(0)

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return
    const computedStyles = window.getComputedStyle(container)
    const fontFamily = computedStyles.fontFamily?.trim() ?? ''
    const textColor = computedStyles.color?.trim() ?? ''
    const backgroundColor = computedStyles.backgroundColor?.trim() ?? ''

    const chart = createChart(container, {
      layout: {
        ...(fontFamily ? { fontFamily } : {}),
        ...(textColor ? { textColor } : {}),
        attributionLogo: false,
        ...(backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)'
          ? { background: { color: backgroundColor } }
          : {}),
      },
      grid: {
        vertLines: { color: '#88888825' },
        horzLines: { color: '#88888825' },
      },
      timeScale: {
        rightOffset: DEFAULT_RIGHT_OFFSET,
        timeVisible: true,
      },
      handleScroll: {
        mouseWheel: false,
        pressedMouseMove: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
      },
      kineticScroll: {
        mouse: false,
        touch: false,
      },
    })

    chartRef.current = chart
    setChartReady((prev) => prev + 1)

    const resizeObserver = new ResizeObserver(() => {
      if (!chartContainerRef.current || !chartRef.current) return
      const width = chartContainerRef.current.clientWidth
      const height = chartContainerRef.current.clientHeight
      if (width > 0 && height > 0) {
        chartRef.current.resize(width, height)
      }
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      mainSeriesRef.current = null
    }
  }, [resetKey])

  return { chartRef, chartContainerRef, mainSeriesRef, chartReady }
}
