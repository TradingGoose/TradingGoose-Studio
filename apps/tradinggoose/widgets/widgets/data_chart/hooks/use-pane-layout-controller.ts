'use client'

import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useState } from 'react'
import type { IChartApi, IPaneApi } from 'lightweight-charts'

type UsePaneLayoutControllerArgs = {
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  chartReady: number
  indicatorRuntimeVersion: number
  chartResetKey: string
}

export const usePaneLayoutController = ({
  chartRef,
  chartContainerRef,
  chartReady,
  indicatorRuntimeVersion,
  chartResetKey,
}: UsePaneLayoutControllerArgs) => {
  const [paneSnapshot, setPaneSnapshot] = useState<IPaneApi<any>[]>([])
  const [paneLayout, setPaneLayout] = useState<Array<{ top: number; height: number }>>([])

  useEffect(() => {
    setPaneSnapshot([])
    setPaneLayout([])
  }, [chartResetKey])

  const refreshPaneSnapshot = useCallback(() => {
    if (!chartRef.current) return
    const panes = chartRef.current.panes()
    setPaneSnapshot((prev) => {
      if (prev.length === panes.length && prev.every((pane, index) => pane === panes[index])) {
        return prev
      }
      return panes
    })
  }, [chartRef])

  const updatePaneLayout = useCallback(() => {
    const container = chartContainerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const next: Array<{ top: number; height: number }> = []

    paneSnapshot.forEach((pane) => {
      const element = pane.getHTMLElement()
      if (!element) return
      const rect = element.getBoundingClientRect()
      const top = rect.top - containerRect.top
      const height = rect.height
      const index = pane.paneIndex()
      next[index] = { top, height }
    })

    setPaneLayout((prev) => {
      const maxLength = Math.max(prev.length, next.length)
      for (let i = 0; i < maxLength; i += 1) {
        const prevEntry = prev[i]
        const nextEntry = next[i]
        if (!prevEntry && !nextEntry) continue
        if (!prevEntry || !nextEntry) return next
        if (Math.abs(prevEntry.top - nextEntry.top) > 0.5) return next
        if (Math.abs(prevEntry.height - nextEntry.height) > 0.5) return next
      }
      return prev
    })
  }, [chartContainerRef, paneSnapshot])

  useEffect(() => {
    refreshPaneSnapshot()
  }, [chartReady, indicatorRuntimeVersion, refreshPaneSnapshot])

  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return
    let raf: number | null = null
    const schedule = () => {
      if (raf !== null) return
      raf = window.requestAnimationFrame(() => {
        raf = null
        updatePaneLayout()
      })
    }
    const handlePointerActivity = () => {
      schedule()
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(container)
    paneSnapshot.forEach((pane) => {
      const element = pane.getHTMLElement()
      if (element) observer.observe(element)
    })

    container.addEventListener('pointermove', handlePointerActivity, true)
    container.addEventListener('mousemove', handlePointerActivity, true)

    return () => {
      if (raf !== null) {
        window.cancelAnimationFrame(raf)
      }
      container.removeEventListener('pointermove', handlePointerActivity, true)
      container.removeEventListener('mousemove', handlePointerActivity, true)
      observer.disconnect()
    }
  }, [chartContainerRef, paneSnapshot, updatePaneLayout])

  const handleMovePaneUp = useCallback(
    (pane: IPaneApi<any>) => {
      const index = pane.paneIndex()
      if (index <= 0) return
      pane.moveTo(index - 1)
      refreshPaneSnapshot()
    },
    [refreshPaneSnapshot]
  )

  const handleMovePaneDown = useCallback(
    (pane: IPaneApi<any>) => {
      const index = pane.paneIndex()
      if (index >= paneSnapshot.length - 1) return
      pane.moveTo(index + 1)
      refreshPaneSnapshot()
    },
    [paneSnapshot.length, refreshPaneSnapshot]
  )

  return {
    paneSnapshot,
    paneLayout,
    handleMovePaneUp,
    handleMovePaneDown,
  }
}
