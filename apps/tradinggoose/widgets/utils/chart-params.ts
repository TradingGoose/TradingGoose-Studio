import { useEffect, useRef } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import {
  DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
  type DataChartWidgetUpdateEventDetail,
} from '@/widgets/events'

interface UseDataChartParamsPersistenceOptions {
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  panelId?: string
  widget?: WidgetInstance | null
  params?: Record<string, unknown> | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeDrawToolsSnapshotById = (raw: unknown): Map<string, string> => {
  if (!Array.isArray(raw)) return new Map()

  const snapshotById = new Map<string, string>()
  raw.forEach((entry) => {
    if (!isRecord(entry)) return
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) return
    const snapshot =
      typeof entry.snapshot === 'string' && entry.snapshot.trim().length > 0
        ? entry.snapshot.trim()
        : ''
    if (!snapshot) return
    snapshotById.set(id, snapshot)
  })
  return snapshotById
}

const mergeDrawToolsSnapshots = (
  currentDrawTools: unknown,
  incomingDrawTools: unknown
): unknown => {
  if (!Array.isArray(incomingDrawTools)) return incomingDrawTools
  if (!Array.isArray(currentDrawTools)) return incomingDrawTools

  const snapshotById = normalizeDrawToolsSnapshotById(currentDrawTools)
  if (snapshotById.size === 0) return incomingDrawTools

  let changed = false
  const merged = incomingDrawTools.map((entry) => {
    if (!isRecord(entry)) return entry

    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) return entry

    const hasExplicitSnapshotField = Object.prototype.hasOwnProperty.call(entry, 'snapshot')
    if (hasExplicitSnapshotField) {
      return entry
    }

    const hasSnapshot =
      typeof entry.snapshot === 'string' && entry.snapshot.trim().length > 0
    if (hasSnapshot) return entry

    const snapshot = snapshotById.get(id)
    if (!snapshot) return entry

    changed = true
    return { ...entry, snapshot }
  })

  return changed ? merged : incomingDrawTools
}

const mergeNestedParams = (
  currentParams: Record<string, unknown>,
  incomingParams: Record<string, unknown>
): Record<string, unknown> => {
  const merged = {
    ...currentParams,
    ...incomingParams,
  }

  const currentView = isRecord(currentParams.view) ? currentParams.view : null
  const incomingView = isRecord(incomingParams.view) ? incomingParams.view : null
  if (incomingView) {
    const nextView = currentView ? { ...currentView, ...incomingView } : { ...incomingView }
    if ('drawTools' in nextView) {
      nextView.drawTools = mergeDrawToolsSnapshots(currentView?.drawTools, nextView.drawTools)
    }
    merged.view = nextView
  }

  const currentData = isRecord(currentParams.data) ? currentParams.data : null
  const incomingData = isRecord(incomingParams.data) ? incomingParams.data : null
  if (incomingData) {
    merged.data = currentData ? { ...currentData, ...incomingData } : { ...incomingData }
  }

  const currentRuntime = isRecord(currentParams.runtime) ? currentParams.runtime : null
  const incomingRuntime = isRecord(incomingParams.runtime) ? incomingParams.runtime : null
  if (incomingRuntime) {
    merged.runtime = currentRuntime
      ? { ...currentRuntime, ...incomingRuntime }
      : { ...incomingRuntime }
  }

  return merged
}

export function useDataChartParamsPersistence({
  onWidgetParamsChange,
  panelId,
  widget,
  params,
}: UseDataChartParamsPersistenceOptions) {
  const latestParamsRef = useRef<Record<string, unknown> | null>(
    params && typeof params === 'object' ? (params as Record<string, unknown>) : null
  )

  useEffect(() => {
    latestParamsRef.current =
      params && typeof params === 'object' ? (params as Record<string, unknown>) : null
  }, [params])

  useEffect(() => {
    if (!onWidgetParamsChange) {
      return
    }

    const handleParamsUpdate = (event: Event) => {
      const detail = (event as CustomEvent<DataChartWidgetUpdateEventDetail>).detail
      if (!detail?.params || !isRecord(detail.params)) return
      if (panelId && detail.panelId && detail.panelId !== panelId) return
      if (widget?.key && detail.widgetKey && detail.widgetKey !== widget.key) return

      const currentParams =
        latestParamsRef.current && typeof latestParamsRef.current === 'object'
          ? latestParamsRef.current
          : {}

      const nextParams = mergeNestedParams(currentParams, detail.params)
      latestParamsRef.current = nextParams

      onWidgetParamsChange(nextParams)
    }

    window.addEventListener(
      DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
      handleParamsUpdate as EventListener
    )

    return () => {
      window.removeEventListener(
        DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT,
        handleParamsUpdate as EventListener
      )
    }
  }, [onWidgetParamsChange, panelId, widget?.key])
}

interface EmitDataChartParamsOptions {
  params: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export function emitDataChartParamsChange({
  params,
  panelId,
  widgetKey,
}: EmitDataChartParamsOptions) {
  if (!params || Object.keys(params).length === 0) return

  window.dispatchEvent(
    new CustomEvent<DataChartWidgetUpdateEventDetail>(DATA_CHART_WIDGET_UPDATE_PARAMS_EVENT, {
      detail: {
        params,
        panelId,
        widgetKey,
      },
    })
  )
}
