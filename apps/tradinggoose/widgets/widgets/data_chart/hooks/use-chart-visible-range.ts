'use client'

import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import type { IChartApi } from 'lightweight-charts'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { DataChartDataContext, dataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

type UseChartVisibleRangeArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  dataContext: DataChartDataContext
  params: dataChartWidgetParams
  chartReady: number
  interval?: string | null
  panelId?: string
  widgetKey?: string
}

type RangeMs = {
  startMs: number
  endMs: number
}

const resolveVisibleRangeMs = (
  range: { from: number; to: number },
  openTimes: number[],
  intervalMs?: number | null
): RangeMs | null => {
  if (!openTimes.length) return null
  const lastIndex = openTimes.length - 1
  const fromIndexRaw = Math.floor(range.from)
  const toIndexRaw = Math.ceil(range.to)
  const fromIndex = Math.max(0, Math.min(lastIndex, fromIndexRaw))
  const toIndex = Math.max(0, Math.min(lastIndex, toIndexRaw))
  let startMs = openTimes[fromIndex]
  let endMs = openTimes[toIndex]

  if (intervalMs && Number.isFinite(intervalMs)) {
    if (fromIndexRaw < 0) {
      startMs = Math.max(0, openTimes[0] + fromIndexRaw * intervalMs)
    }
    if (toIndexRaw > lastIndex) {
      endMs = openTimes[lastIndex] + (toIndexRaw - lastIndex) * intervalMs
    }
  }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  return { startMs, endMs }
}

export const useChartVisibleRange = ({
  chartRef,
  dataContext,
  params,
  chartReady,
  interval,
  panelId,
  widgetKey,
}: UseChartVisibleRangeArgs) => {
  const viewRef = useRef(params.view)
  const lastSavedRef = useRef<{ startMs: number; endMs: number; interval?: string | null } | null>(
    null
  )
  const pendingRef = useRef<RangeMs | null>(null)
  const flushTimerRef = useRef<number | null>(null)

  useEffect(() => {
    viewRef.current = params.view
  }, [params.view])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const timeScale = chart.timeScale()

    const flush = () => {
      flushTimerRef.current = null
      const pending = pendingRef.current
      if (!pending) return
      pendingRef.current = null

      const last = lastSavedRef.current
      if (
        last &&
        last.startMs === pending.startMs &&
        last.endMs === pending.endMs &&
        last.interval === interval
      ) {
        return
      }
      lastSavedRef.current = { ...pending, interval }

      const nextView = { ...(viewRef.current ?? {}) } as Record<string, unknown>
      nextView.start = pending.startMs
      nextView.end = pending.endMs
      if (interval && nextView.interval !== interval) {
        nextView.interval = interval
      }

      emitDataChartParamsChange({
        params: { view: nextView },
        panelId,
        widgetKey,
      })
    }

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return
      flushTimerRef.current = window.setTimeout(flush, 250)
    }

    const handleRangeChange = (range: { from: number; to: number } | null) => {
      if (!range) return
      const openTimes = dataContext.openTimeMsByIndexRef.current
      const next = resolveVisibleRangeMs(range, openTimes, dataContext.intervalMs)
      if (!next) return
      pendingRef.current = next
      scheduleFlush()
    }

    timeScale.subscribeVisibleLogicalRangeChange(handleRangeChange)

    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      try {
        timeScale.unsubscribeVisibleLogicalRangeChange(handleRangeChange)
      } catch {
        // Ignore disposal races during chart teardown.
      }
    }
  }, [chartRef, dataContext, chartReady, interval, panelId, widgetKey])
}
