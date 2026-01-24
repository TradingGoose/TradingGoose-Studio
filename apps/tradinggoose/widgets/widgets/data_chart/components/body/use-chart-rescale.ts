'use client'

import { type MutableRefObject, useCallback, useRef } from 'react'
import type { Chart, KLineData } from 'klinecharts'
import { fitChartToData } from '@/widgets/widgets/data_chart/components/chart-utils'

type UseChartRescaleArgs = {
  chartRef: MutableRefObject<Chart | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
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
    (expectedBars?: number | null) => {
      if (!shouldRescaleRef.current) return
      if (rescaleRafRef.current !== null) return

      const chart = chartRef.current
      if (!chart) return

      rescaleRafRef.current = window.requestAnimationFrame(() => {
        rescaleRafRef.current = null
        if (!shouldRescaleRef.current) return
        const dataList = chart.getDataList() as KLineData[]
        const didScale = fitChartToData(
          chart,
          dataList,
          chartContainerRef.current,
          expectedBars ?? undefined
        )
        if (didScale) {
          rescaleAttemptsRef.current = 0
          shouldRescaleRef.current = false
          return
        }

        rescaleAttemptsRef.current += 1
        if (rescaleAttemptsRef.current <= 30) {
          scheduleRescale(expectedBars)
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
