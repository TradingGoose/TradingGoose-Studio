'use client'

import type { MutableRefObject } from 'react'
import { useCallback, useMemo, useState } from 'react'
import type { IPaneApi, ISeriesApi } from 'lightweight-charts'
import { buildInputsMapFromMeta } from '@/lib/indicators/input-meta'
import type { InputMetaMap } from '@/lib/indicators/types'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { IndicatorPlotValue } from '@/widgets/widgets/data_chart/hooks/use-indicator-legend'
import type {
  DataChartWidgetParams,
  IndicatorRuntimeEntry,
} from '@/widgets/widgets/data_chart/types'
import { resolveRuntimePaneIndex } from '@/widgets/widgets/data_chart/utils/indicator-runtime'

type IndicatorMetaEntry = { name: string; inputMeta?: InputMetaMap | null }
type IndicatorControlItem = {
  id: string
  name: string
  inputMeta?: InputMetaMap | null
  inputs?: Record<string, unknown>
  values: IndicatorPlotValue[]
  isHidden: boolean
  errorMessage?: string
}

type UseIndicatorControlsArgs = {
  view: DataChartWidgetParams['view'] | undefined
  panelId?: string
  widgetKey?: string
  pineIndicatorIds: string[]
  indicatorMetaById: Map<string, IndicatorMetaEntry>
  indicatorRefsById: Map<string, { inputs?: Record<string, unknown> }>
  indicatorLegend: Map<string, IndicatorPlotValue[]>
  hiddenIndicators: Set<string>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  indicatorRuntimeVersion: number
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  paneSnapshot: IPaneApi<any>[]
  chartResetKey: string
}

type IndicatorControlsByPane = Map<number, IndicatorControlItem[]>

export const useIndicatorControls = ({
  view,
  panelId,
  widgetKey,
  pineIndicatorIds,
  indicatorMetaById,
  indicatorRefsById,
  indicatorLegend,
  hiddenIndicators,
  indicatorRuntimeRef,
  indicatorRuntimeVersion,
  mainSeriesRef,
  paneSnapshot,
  chartResetKey,
}: UseIndicatorControlsArgs) => {
  const [settingsIndicatorId, setSettingsIndicatorId] = useState<string | null>(null)
  const [settingsDraft, setSettingsDraft] = useState<Record<string, unknown>>({})

  const updateView = useCallback(
    (nextView: DataChartWidgetParams['view']) => {
      emitDataChartParamsChange({
        params: {
          view: nextView,
        },
        panelId,
        widgetKey,
      })
    },
    [panelId, widgetKey]
  )

  const handleToggleHidden = useCallback(
    (indicatorId: string) => {
      const currentView = view ?? {}
      const currentRefs = Array.isArray(currentView.pineIndicators)
        ? currentView.pineIndicators
        : []
      const nextRefs = currentRefs.map((ref) => {
        if (ref.id !== indicatorId) return ref
        const isHidden = ref.visible === false
        return { ...ref, visible: isHidden }
      })
      updateView({
        ...currentView,
        pineIndicators: nextRefs,
      })
    },
    [view, updateView]
  )

  const handleRemoveIndicator = useCallback(
    (indicatorId: string) => {
      const currentView = view ?? {}
      const currentRefs = Array.isArray(currentView.pineIndicators)
        ? currentView.pineIndicators
        : []
      const nextRefs = currentRefs.filter((ref) => ref.id !== indicatorId)
      updateView({
        ...currentView,
        pineIndicators: nextRefs,
      })
    },
    [view, updateView]
  )

  const handleUpdateIndicatorInputs = useCallback(
    (indicatorId: string, inputs: Record<string, unknown>) => {
      const currentView = view ?? {}
      const currentRefs = Array.isArray(currentView.pineIndicators)
        ? currentView.pineIndicators
        : []
      const hasExisting = currentRefs.some((ref) => ref.id === indicatorId)
      const nextRefs = hasExisting
        ? currentRefs.map((ref) => (ref.id === indicatorId ? { ...ref, inputs } : ref))
        : [...currentRefs, { id: indicatorId, inputs }]
      updateView({
        ...currentView,
        pineIndicators: nextRefs,
      })
    },
    [view, updateView]
  )

  const handleOpenSettings = useCallback(
    (indicatorId: string) => {
      const meta = indicatorMetaById.get(indicatorId)
      const inputs = buildInputsMapFromMeta(
        meta?.inputMeta ?? undefined,
        indicatorRefsById.get(indicatorId)?.inputs
      )
      setSettingsIndicatorId(indicatorId)
      setSettingsDraft(inputs)
    },
    [indicatorMetaById, indicatorRefsById]
  )

  const handleCloseSettings = useCallback(() => {
    setSettingsIndicatorId(null)
    setSettingsDraft({})
  }, [])

  const handleSaveSettings = useCallback(() => {
    if (!settingsIndicatorId) return
    const meta = indicatorMetaById.get(settingsIndicatorId)
    const nextInputs = buildInputsMapFromMeta(meta?.inputMeta ?? undefined, settingsDraft)
    handleUpdateIndicatorInputs(settingsIndicatorId, nextInputs)
    handleCloseSettings()
  }, [
    settingsIndicatorId,
    indicatorMetaById,
    settingsDraft,
    handleUpdateIndicatorInputs,
    handleCloseSettings,
  ])

  const handleDraftChange = useCallback((title: string, value: unknown) => {
    setSettingsDraft((prev) => ({
      ...prev,
      [title]: value,
    }))
  }, [])

  const settingsMeta = useMemo(() => {
    if (!settingsIndicatorId) return null
    return indicatorMetaById.get(settingsIndicatorId) ?? null
  }, [settingsIndicatorId, indicatorMetaById])

  const indicatorControlsByPane = useMemo<IndicatorControlsByPane>(() => {
    const mainPaneIndex = mainSeriesRef.current?.getPane().paneIndex() ?? 0
    const grouped = new Map<number, IndicatorControlItem[]>()

    pineIndicatorIds.forEach((id) => {
      const meta = indicatorMetaById.get(id)
      if (!meta) return
      const runtimeEntry = indicatorRuntimeRef.current.get(id)
      if (!runtimeEntry) return
      const paneIndex = resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex)
      const list = grouped.get(paneIndex) ?? []
      list.push({
        id,
        name: meta.name,
        inputMeta: meta.inputMeta,
        inputs: indicatorRefsById.get(id)?.inputs,
        values: indicatorLegend.get(id) ?? [],
        isHidden: hiddenIndicators.has(id),
        errorMessage: runtimeEntry?.errorMessage,
      })
      grouped.set(paneIndex, list)
    })

    return grouped
  }, [
    pineIndicatorIds,
    indicatorMetaById,
    indicatorLegend,
    hiddenIndicators,
    indicatorRuntimeVersion,
    indicatorRefsById,
    paneSnapshot,
    chartResetKey,
    mainSeriesRef,
    indicatorRuntimeRef,
  ])

  return {
    settingsIndicatorId,
    settingsDraft,
    settingsMeta,
    handleToggleHidden,
    handleRemoveIndicator,
    handleUpdateIndicatorInputs,
    handleOpenSettings,
    handleCloseSettings,
    handleSaveSettings,
    handleDraftChange,
    indicatorControlsByPane,
    hasIndicatorRuntime: indicatorRuntimeRef.current.size > 0,
  }
}
