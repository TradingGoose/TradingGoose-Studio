'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { DEFAULT_RIGHT_OFFSET } from '@/widgets/widgets/data_chart/utils/chart-styles'

export const useChartInstance = (resetKey?: string | number) => {
  const chartContainerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const beforeDestroyRef = useRef<(() => void) | null>(null)
  const [containerVersion, setContainerVersion] = useState(0)
  type MainSeries =
    | ISeriesApi<'Candlestick'>
    | ISeriesApi<'Bar'>
    | ISeriesApi<'Area'>
  const mainSeriesRef = useRef<MainSeries | null>(null)
  const [chartReady, setChartReady] = useState(0)
  const chartContainerCallbackRef = useCallback((container: HTMLDivElement | null) => {
    if (chartContainerRef.current === container) return
    chartContainerRef.current = container
    setContainerVersion((prev) => prev + 1)
  }, [])
  const registerBeforeDestroy = useCallback((callback: (() => void) | null) => {
    beforeDestroyRef.current = callback
  }, [])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return
    const chartHost = document.createElement('div')
    chartHost.style.width = '100%'
    chartHost.style.height = '100%'
    chartHost.style.position = 'relative'
    container.replaceChildren(chartHost)

    const computedStyles = window.getComputedStyle(container)
    const fontFamily = computedStyles.fontFamily?.trim() ?? ''
    const textColor = computedStyles.color?.trim() ?? ''
    const backgroundColor = computedStyles.backgroundColor?.trim() ?? ''

    const chart = createChart(chartHost, {
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

    let isDisposing = false
    const resizeObserver = new ResizeObserver(() => {
      if (isDisposing || !chartContainerRef.current || !chartRef.current) return
      const width = chartContainerRef.current.clientWidth
      const height = chartContainerRef.current.clientHeight
      if (width > 0 && height > 0) {
        try {
          chartRef.current.resize(width, height)
        } catch {
          // Ignore observer races while the chart is being torn down.
        }
      }
    })

    resizeObserver.observe(container)

    return () => {
      isDisposing = true
      try {
        beforeDestroyRef.current?.()
      } catch (error) {
        console.error('[useChartInstance] Error in before-destroy callback:', error)
      }
      beforeDestroyRef.current = null
      chartRef.current = null
      mainSeriesRef.current = null
      resizeObserver.disconnect()

      if (container.contains(chartHost)) {
        chartHost.remove()
      }

      window.requestAnimationFrame(() => {
        try {
          chart.remove()
        } catch {
          // Ignore disposal races from chart internals during reset.
        }
      })
    }
  }, [resetKey, containerVersion])

  return {
    chartRef,
    chartContainerRef,
    chartContainerCallbackRef,
    mainSeriesRef,
    chartReady,
    registerBeforeDestroy,
  }
}
