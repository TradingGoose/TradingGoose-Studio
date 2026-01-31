'use client'

import { type MutableRefObject, useCallback, useRef } from 'react'
import type { IChartApi } from 'lightweight-charts'
import { DEFAULT_RIGHT_OFFSET } from '@/widgets/widgets/new_data_chart/utils/chart-styles'

type UseChartRescaleArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
}

const resolveChartWidth = (chart: IChartApi, container: HTMLDivElement | null) => {
  const timeScaleWidth = chart.timeScale().width()
  if (timeScaleWidth > 0) return timeScaleWidth
  if (container?.clientWidth && container.clientWidth > 0) return container.clientWidth
  return 0
}

const resolveWindowBars = (
  expectedBars?: number | null
): number | null => {
  if (typeof expectedBars !== 'number' || !Number.isFinite(expectedBars)) return null
  if (expectedBars <= 0) return null
  return Math.floor(expectedBars)
}

export const useChartRescale = ({ chartRef, chartContainerRef }: UseChartRescaleArgs) => {
  const shouldRescaleRef = useRef(true)
  const rescaleRafRef = useRef<number | null>(null)
  const rescaleAttemptsRef = useRef(0)

  const resetRescale = useCallback(() => {
    shouldRescaleRef.current = true
    rescaleAttemptsRef.current = 0
  }, [])

  const scheduleRescale = useCallback(
    (expectedBars?: number | null, dataLength?: number | null) => {
      if (!shouldRescaleRef.current) return
      if (rescaleRafRef.current !== null) return

      const chart = chartRef.current
      if (!chart) return

      rescaleRafRef.current = window.requestAnimationFrame(() => {
        rescaleRafRef.current = null
        if (!shouldRescaleRef.current) return

        const width = resolveChartWidth(chart, chartContainerRef.current)
        if (!width) {
          rescaleAttemptsRef.current += 1
        } else {
          const resolvedLength =
            typeof dataLength === 'number' && Number.isFinite(dataLength) && dataLength > 0
              ? Math.floor(dataLength)
              : 0
          const windowBars = resolveWindowBars(expectedBars)

          if (resolvedLength > 0) {
            const timeScale = chart.timeScale()
            timeScale.resetTimeScale()
            timeScale.applyOptions({ rightOffset: DEFAULT_RIGHT_OFFSET })

            if (!windowBars) {
              timeScale.fitContent()
            } else {
              const lastIndex = Math.max(resolvedLength - 1, 0)
              const from = lastIndex - (windowBars - 1)
              const to = lastIndex + DEFAULT_RIGHT_OFFSET
              timeScale.setVisibleLogicalRange({ from, to })
            }

            rescaleAttemptsRef.current = 0
            shouldRescaleRef.current = false
            return
          }

          rescaleAttemptsRef.current += 1
        }

        if (rescaleAttemptsRef.current <= 30) {
          scheduleRescale(expectedBars, dataLength)
          return
        }

        shouldRescaleRef.current = false
      })
    },
    [chartContainerRef, chartRef]
  )

  const cancelRescale = useCallback(() => {
    if (rescaleRafRef.current !== null) {
      window.cancelAnimationFrame(rescaleRafRef.current)
      rescaleRafRef.current = null
    }
  }, [])

  return { resetRescale, scheduleRescale, cancelRescale }
}
