import { useEffect, useRef } from 'react'
import type { WidgetInstance } from '@/widgets/layout'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-snapshot'
import { normalizeManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-snapshot'
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

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const areValuesEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true

  const aIsArray = Array.isArray(a)
  const bIsArray = Array.isArray(b)
  if (aIsArray || bIsArray) {
    if (!aIsArray || !bIsArray) return false
    if (a.length !== b.length) return false

    for (let index = 0; index < a.length; index += 1) {
      if (!areValuesEqual(a[index], b[index])) {
        return false
      }
    }
    return true
  }

  const aIsRecord = isPlainRecord(a)
  const bIsRecord = isPlainRecord(b)
  if (aIsRecord || bIsRecord) {
    if (!aIsRecord || !bIsRecord) return false

    const aKeys = Object.keys(a)
    const bKeys = Object.keys(b)
    if (aKeys.length !== bKeys.length) return false

    for (const key of aKeys) {
      if (!(key in b)) return false
      if (!areValuesEqual(a[key], b[key])) return false
    }

    return true
  }

  return false
}

const normalizeDrawToolsSnapshotById = (raw: unknown): Map<string, ManualOwnerSnapshot> => {
  if (!Array.isArray(raw)) return new Map()

  const snapshotById = new Map<string, ManualOwnerSnapshot>()
  raw.forEach((entry) => {
    if (!isRecord(entry)) return
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!id) return
    const snapshot = normalizeManualOwnerSnapshot(entry.snapshot)
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

    const hasSnapshot = normalizeManualOwnerSnapshot(entry.snapshot) !== null
    if (hasSnapshot) return entry

    const snapshot = snapshotById.get(id)
    if (snapshot === undefined) return entry

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
      if (areValuesEqual(currentParams, nextParams)) {
        return
      }

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
