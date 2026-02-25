'use client'

import type { MutableRefObject } from 'react'
import { useEffect } from 'react'
import type { IChartApi } from 'lightweight-charts'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'

type TraceDrawRouting = (event: string, details?: () => Record<string, unknown>) => void

type UsePointerPaneTrackingArgs = {
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  chartRef: MutableRefObject<IChartApi | null>
  traceDrawRouting: TraceDrawRouting
  pointerPaneIndexRef: MutableRefObject<number | null>
  pendingManualToolTypeRef: MutableRefObject<ManualToolType | null>
  pendingManualToolPaneLockRef: MutableRefObject<number | null>
  startManualToolForSelection: (
    toolType: ManualToolType,
    paneIndexOverride?: number | null
  ) => boolean
}

export const usePointerPaneTracking = ({
  chartContainerRef,
  chartRef,
  traceDrawRouting,
  pointerPaneIndexRef,
  pendingManualToolTypeRef,
  pendingManualToolPaneLockRef,
  startManualToolForSelection,
}: UsePointerPaneTrackingArgs) => {
  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return

    const updatePointerPaneIndex = (
      clientX: number,
      clientY: number,
      options?: { traceEvent?: string; target?: EventTarget | null }
    ) => {
      const chart = chartRef.current
      if (!chart) {
        pointerPaneIndexRef.current = null
        return null
      }

      const panes = chart.panes()
      const chartElement = chart.chartElement()
      const chartRect = chartElement.getBoundingClientRect()
      const pointerX = clientX - chartRect.left
      const pointerY = clientY - chartRect.top
      const paneBounds: Array<{
        paneIndex: number
        top: number
        bottom: number
        left: number
        right: number
      }> = []

      const maybeTargetNode =
        typeof Node !== 'undefined' && options?.target instanceof Node ? options.target : null
      if (maybeTargetNode) {
        for (const pane of panes) {
          const element = pane.getHTMLElement()
          if (!element) continue
          if (!element.contains(maybeTargetNode)) continue
          const paneIndex = pane.paneIndex()
          pointerPaneIndexRef.current = paneIndex
          if (options?.traceEvent) {
            traceDrawRouting(options.traceEvent, () => ({
              clientX,
              clientY,
              pointerX,
              pointerY,
              paneIndex,
              hitMethod: 'target-pane',
            }))
          }
          return paneIndex
        }
      }

      for (const pane of panes) {
        const element = pane.getHTMLElement()
        if (!element) continue
        const rect = element.getBoundingClientRect()
        const top = rect.top - chartRect.top
        const bottom = top + rect.height
        const left = rect.left - chartRect.left
        const right = left + rect.width
        const paneIndex = pane.paneIndex()
        paneBounds.push({ paneIndex, top, bottom, left, right })
        if (pointerX >= left && pointerX <= right && pointerY >= top && pointerY <= bottom) {
          pointerPaneIndexRef.current = paneIndex
          if (options?.traceEvent) {
            traceDrawRouting(options.traceEvent, () => ({
              clientX,
              clientY,
              pointerY,
              pointerX,
              paneIndex,
              paneBounds,
              hitMethod: 'bounds',
            }))
          }
          return paneIndex
        }
      }

      const paneSizeBounds: Array<{ paneIndex: number; top: number; bottom: number }> = []
      const panesByIndex = [...panes].sort((left, right) => left.paneIndex() - right.paneIndex())
      let nextTop = 0
      for (const pane of panesByIndex) {
        const paneIndex = pane.paneIndex()
        const paneDimensions = chart.paneSize(paneIndex)
        const top = nextTop
        const bottom = top + paneDimensions.height
        paneSizeBounds.push({ paneIndex, top, bottom })
        if (pointerY >= top && pointerY <= bottom) {
          pointerPaneIndexRef.current = paneIndex
          if (options?.traceEvent) {
            traceDrawRouting(options.traceEvent, () => ({
              clientX,
              clientY,
              pointerX,
              pointerY,
              paneIndex,
              paneBounds,
              paneSizeBounds,
              hitMethod: 'pane-size',
            }))
          }
          return paneIndex
        }
        nextTop = bottom
      }

      pointerPaneIndexRef.current = null
      if (options?.traceEvent) {
        traceDrawRouting(options.traceEvent, () => ({
          clientX,
          clientY,
          pointerX,
          pointerY,
          paneIndex: null,
          paneBounds,
          paneSizeBounds,
          hitMethod: 'none',
        }))
      }
      return null
    }

    const startPendingTool = (
      paneIndex: number | null,
      source: 'pointerdown-pending' | 'mousedown-pending'
    ) => {
      const pendingToolType = pendingManualToolTypeRef.current
      if (!pendingToolType) return
      const paneLock = pendingManualToolPaneLockRef.current
      if (paneLock !== null && paneIndex !== paneLock) {
        traceDrawRouting(`${source}-pane-lock-miss`, () => ({
          paneIndex,
          paneLock,
          pendingToolType,
        }))
        return
      }
      const started = startManualToolForSelection(pendingToolType, paneIndex)
      if (started) {
        pendingManualToolTypeRef.current = null
        pendingManualToolPaneLockRef.current = null
      } else if (paneIndex !== null) {
        pendingManualToolPaneLockRef.current = paneIndex
      }
      traceDrawRouting(source, () => ({
        paneIndex,
        paneLock,
        pendingToolType,
        started,
        nextPaneLock: pendingManualToolPaneLockRef.current,
      }))
    }

    const handlePointerMove = (event: PointerEvent) => {
      updatePointerPaneIndex(event.clientX, event.clientY, { target: event.target })
    }

    const handlePointerDown = (event: PointerEvent) => {
      const paneIndex = updatePointerPaneIndex(event.clientX, event.clientY, {
        traceEvent: 'pointer-pane-hit',
        target: event.target,
      })
      startPendingTool(paneIndex, 'pointerdown-pending')
    }

    const handleMouseMove = (event: MouseEvent) => {
      updatePointerPaneIndex(event.clientX, event.clientY, { target: event.target })
    }

    const handleMouseDown = (event: MouseEvent) => {
      const paneIndex = updatePointerPaneIndex(event.clientX, event.clientY, {
        traceEvent: 'pointer-pane-hit',
        target: event.target,
      })
      startPendingTool(paneIndex, 'mousedown-pending')
    }

    container.addEventListener('pointermove', handlePointerMove, true)
    container.addEventListener('pointerdown', handlePointerDown, true)
    container.addEventListener('mousemove', handleMouseMove, true)
    container.addEventListener('mousedown', handleMouseDown, true)

    return () => {
      container.removeEventListener('pointermove', handlePointerMove, true)
      container.removeEventListener('pointerdown', handlePointerDown, true)
      container.removeEventListener('mousemove', handleMouseMove, true)
      container.removeEventListener('mousedown', handleMouseDown, true)
    }
  }, [
    chartContainerRef,
    chartRef,
    traceDrawRouting,
    pointerPaneIndexRef,
    pendingManualToolTypeRef,
    pendingManualToolPaneLockRef,
    startManualToolForSelection,
  ])
}
