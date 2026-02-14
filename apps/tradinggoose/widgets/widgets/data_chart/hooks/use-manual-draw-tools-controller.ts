'use client'

import type { MutableRefObject } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IChartApi, IPaneApi, ISeriesApi } from 'lightweight-charts'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import {
  normalizeManualOwnerSnapshot,
  serializeManualOwnerSnapshot,
} from '@/widgets/widgets/data_chart/drawings/snapshot'
import { startManualToolForSelection as startManualToolForSelectionCore } from '@/widgets/widgets/data_chart/drawings/start-manual-tool-for-selection'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import { useManualLineToolsAdapter } from '@/widgets/widgets/data_chart/drawings/use-adapter'
import { usePointerPaneTracking } from '@/widgets/widgets/data_chart/hooks/use-pointer-pane-tracking'
import type {
  DataChartWidgetParams,
  DrawToolsRef,
  IndicatorRuntimeEntry,
} from '@/widgets/widgets/data_chart/types'
import {
  DEFAULT_MANUAL_DRAW_TOOLS,
  normalizeDrawToolsRefs,
} from '@/widgets/widgets/data_chart/utils/draw-tools'
import { resolveRuntimePaneIndex } from '@/widgets/widgets/data_chart/utils/indicator-runtime'

type TraceDrawRouting = (event: string, details?: () => Record<string, unknown>) => void

type UseManualDrawToolsControllerArgs = {
  view: DataChartWidgetParams['view'] | undefined
  panelId?: string
  widgetKey?: string
  chartResetKey: string
  chartRef: MutableRefObject<IChartApi | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  chartReady: number
  registerBeforeDestroy: (callback: (() => void) | null) => void
  dataVersion: number
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  indicatorRuntimeVersion: number
  paneSnapshot: IPaneApi<any>[]
  paneLayout: Array<{ top: number; height: number }>
  traceDrawRouting: TraceDrawRouting
}

export const useManualDrawToolsController = ({
  view,
  panelId,
  widgetKey,
  chartResetKey,
  chartRef,
  chartContainerRef,
  mainSeriesRef,
  chartReady,
  registerBeforeDestroy,
  dataVersion,
  indicatorRuntimeRef,
  indicatorRuntimeVersion,
  paneSnapshot,
  paneLayout,
  traceDrawRouting,
}: UseManualDrawToolsControllerArgs) => {
  const [activeDrawToolsId, setActiveDrawToolsId] = useState<string | null>(null)
  const [transientDrawTools, setTransientDrawTools] = useState<DrawToolsRef[]>([])
  const drawToolsBootstrapScopeRef = useRef<string | null>(null)
  const drawToolsBootstrapDoneRef = useRef(false)
  const pointerPaneIndexRef = useRef<number | null>(null)
  const pendingManualToolTypeRef = useRef<ManualToolType | null>(null)
  const pendingManualToolPaneLockRef = useRef<number | null>(null)

  const drawToolsScopeKey = useMemo(
    () => `${panelId ?? 'panel'}:${widgetKey}:${chartResetKey}`,
    [chartResetKey, panelId, widgetKey]
  )

  const normalizedDrawTools = useMemo(
    () => normalizeDrawToolsRefs(view?.drawTools),
    [view?.drawTools]
  )

  const resolvedDrawTools = useMemo<DrawToolsRef[]>(
    () => (normalizedDrawTools.length > 0 ? normalizedDrawTools : DEFAULT_MANUAL_DRAW_TOOLS),
    [normalizedDrawTools]
  )

  const effectiveDrawTools = useMemo<DrawToolsRef[]>(() => {
    if (transientDrawTools.length === 0) return resolvedDrawTools
    const byId = new Map(resolvedDrawTools.map((entry) => [entry.id, entry]))
    transientDrawTools.forEach((entry) => {
      if (!byId.has(entry.id)) {
        byId.set(entry.id, entry)
      }
    })
    return Array.from(byId.values())
  }, [resolvedDrawTools, transientDrawTools])

  useEffect(() => {
    if (transientDrawTools.length === 0) return
    const persistedIds = new Set(resolvedDrawTools.map((entry) => entry.id))
    const next = transientDrawTools.filter((entry) => !persistedIds.has(entry.id))
    if (next.length !== transientDrawTools.length) {
      setTransientDrawTools(next)
    }
  }, [resolvedDrawTools, transientDrawTools])

  useEffect(() => {
    if (drawToolsBootstrapScopeRef.current === drawToolsScopeKey) return
    drawToolsBootstrapScopeRef.current = drawToolsScopeKey
    drawToolsBootstrapDoneRef.current = false
  }, [drawToolsScopeKey])

  useEffect(() => {
    const currentView = view ?? {}
    const rawDrawTools = Array.isArray(currentView.drawTools) ? currentView.drawTools : []
    const normalized = normalizeDrawToolsRefs(rawDrawTools)
    const needsBootstrap = normalized.length === 0
    const nextDrawTools = needsBootstrap ? DEFAULT_MANUAL_DRAW_TOOLS : normalized

    const currentSerialized = JSON.stringify(rawDrawTools)
    const nextSerialized = JSON.stringify(nextDrawTools)
    if (currentSerialized === nextSerialized) return

    if (needsBootstrap) {
      if (drawToolsBootstrapDoneRef.current) return
      drawToolsBootstrapDoneRef.current = true
    }

    emitDataChartParamsChange({
      params: {
        view: {
          ...currentView,
          drawTools: nextDrawTools,
        },
      },
      panelId,
      widgetKey,
    })
  }, [view, panelId, widgetKey, drawToolsScopeKey])

  useEffect(() => {
    if (effectiveDrawTools.length === 0) {
      if (activeDrawToolsId !== null) {
        setActiveDrawToolsId(null)
      }
      return
    }
    if (activeDrawToolsId && effectiveDrawTools.some((entry) => entry.id === activeDrawToolsId)) {
      return
    }
    setActiveDrawToolsId(effectiveDrawTools[0].id)
  }, [effectiveDrawTools, activeDrawToolsId])

  const handleActiveDrawToolsChange = useCallback((nextDrawToolsId: string) => {
    setActiveDrawToolsId((current) => (current === nextDrawToolsId ? current : nextDrawToolsId))
  }, [])

  const {
    revision: manualLineToolsRevision,
    teardownAll: teardownManualLineTools,
    syncOwnersNow,
    rebindOwnerToPane,
    rebindOrAttachOwnerToPane,
    toManualOwnerId,
    startManualTool,
    removeSelected,
    hideSelected,
    clearAll,
    hasOwnerTools,
    getOwnerSnapshot,
    isOwnerAttached,
    getOwnerVisibilityMode,
    setAllVisibility,
    getToolCapability,
    isNonSelectableToolActive,
    hasSelectedManualDrawingsInPane,
    getSelectedCount,
    reconcileSelection,
  } = useManualLineToolsAdapter({
    chartRef,
    mainSeriesRef,
    chartReady,
    syncVersion: dataVersion,
    panelId,
    drawTools: effectiveDrawTools,
    indicatorRuntimeRef,
    indicatorRuntimeVersion,
    onActiveDrawToolsIdChange: handleActiveDrawToolsChange,
  })

  useEffect(() => {
    registerBeforeDestroy(teardownManualLineTools)
  }, [registerBeforeDestroy, teardownManualLineTools])

  useEffect(() => {
    const currentView = view ?? {}
    const rawDrawTools = Array.isArray(currentView.drawTools) ? currentView.drawTools : []
    if (rawDrawTools.length === 0) return

    const normalized = normalizeDrawToolsRefs(rawDrawTools)
    if (normalized.length === 0) return

    let changed = false
    const nextDrawTools = normalized.map((entry) => {
      const ownerId = toManualOwnerId(entry.id)
      const snapshot = getOwnerSnapshot(ownerId)
      const nextSnapshot = snapshot && snapshot.tools.length > 0 ? snapshot : undefined
      const currentSnapshot = normalizeManualOwnerSnapshot(entry.snapshot) ?? undefined
      const ownerAttached = isOwnerAttached(ownerId)

      if (!nextSnapshot) {
        if (!currentSnapshot) return entry
        if (!ownerAttached) return entry
        changed = true
        return {
          ...entry,
          snapshot: undefined,
        }
      }

      if (
        serializeManualOwnerSnapshot(currentSnapshot) === serializeManualOwnerSnapshot(nextSnapshot)
      ) {
        return entry
      }

      changed = true
      return {
        ...entry,
        snapshot: nextSnapshot,
      }
    })

    if (!changed) return

    const currentSerialized = JSON.stringify(rawDrawTools)
    const nextSerialized = JSON.stringify(nextDrawTools)
    if (currentSerialized === nextSerialized) {
      return
    }

    emitDataChartParamsChange({
      params: {
        view: {
          ...currentView,
          drawTools: nextDrawTools,
        },
      },
      panelId,
      widgetKey,
    })
  }, [
    view,
    panelId,
    widgetKey,
    manualLineToolsRevision,
    toManualOwnerId,
    getOwnerSnapshot,
    isOwnerAttached,
  ])

  const activeDrawToolsRef = useMemo(() => {
    if (effectiveDrawTools.length === 0) return null
    if (!activeDrawToolsId) return effectiveDrawTools[0]
    return (
      effectiveDrawTools.find((entry) => entry.id === activeDrawToolsId) ?? effectiveDrawTools[0]
    )
  }, [effectiveDrawTools, activeDrawToolsId])

  const activeManualOwnerId = useMemo(
    () => (activeDrawToolsRef ? toManualOwnerId(activeDrawToolsRef.id) : null),
    [activeDrawToolsRef, toManualOwnerId]
  )
  const manualOwnerIds = useMemo(
    () => effectiveDrawTools.map((entry) => toManualOwnerId(entry.id)),
    [effectiveDrawTools, toManualOwnerId]
  )

  useEffect(() => {
    if (!activeManualOwnerId) return
    reconcileSelection(activeManualOwnerId)
  }, [activeManualOwnerId, reconcileSelection])

  const resolveSelectedOwnerForPane = useCallback(
    (paneIndex: number) => {
      for (const ownerId of manualOwnerIds) {
        if (getSelectedCount(ownerId) <= 0) continue
        if (hasSelectedManualDrawingsInPane(ownerId, paneIndex)) {
          return ownerId
        }
      }
      return null
    },
    [manualOwnerIds, getSelectedCount, hasSelectedManualDrawingsInPane]
  )

  useEffect(() => {
    return () => {
      pendingManualToolTypeRef.current = null
      pendingManualToolPaneLockRef.current = null
    }
  }, [])

  useEffect(() => {
    pointerPaneIndexRef.current = null
    setTransientDrawTools([])
  }, [chartResetKey])

  const persistDrawTools = useCallback(
    (nextDrawTools: DrawToolsRef[]) => {
      const currentView = view ?? {}
      const currentDrawTools = Array.isArray(currentView.drawTools) ? currentView.drawTools : []
      if (JSON.stringify(currentDrawTools) === JSON.stringify(nextDrawTools)) {
        return
      }

      emitDataChartParamsChange({
        params: {
          view: {
            ...currentView,
            drawTools: nextDrawTools,
          },
        },
        panelId,
        widgetKey,
      })
    },
    [view, panelId, widgetKey]
  )

  const startManualToolForSelection = useCallback(
    (toolType: ManualToolType, paneIndexOverride?: number | null) => {
      return startManualToolForSelectionCore({
        toolType,
        paneIndexOverride,
        pointerPaneIndexRef,
        chartRef,
        mainSeriesRef,
        indicatorRuntimeRef,
        effectiveDrawTools,
        activeDrawToolsId,
        activeDrawToolsRef,
        syncOwnersNow,
        rebindOrAttachOwnerToPane,
        rebindOwnerToPane,
        startManualTool,
        toManualOwnerId,
        isOwnerAttached,
        setTransientDrawTools,
        setActiveDrawToolsId,
        persistDrawTools,
        traceDrawRouting,
        panelId,
        widgetKey,
      })
    },
    [
      activeDrawToolsId,
      activeDrawToolsRef,
      chartRef,
      effectiveDrawTools,
      indicatorRuntimeRef,
      isOwnerAttached,
      mainSeriesRef,
      panelId,
      persistDrawTools,
      traceDrawRouting,
      syncOwnersNow,
      rebindOrAttachOwnerToPane,
      rebindOwnerToPane,
      startManualTool,
      toManualOwnerId,
      widgetKey,
    ]
  )

  usePointerPaneTracking({
    chartContainerRef,
    chartRef,
    traceDrawRouting,
    pointerPaneIndexRef,
    pendingManualToolTypeRef,
    pendingManualToolPaneLockRef,
    startManualToolForSelection,
  })

  const handleSelectManualTool = useCallback(
    (toolType: ManualToolType) => {
      pendingManualToolTypeRef.current = toolType
      pendingManualToolPaneLockRef.current = null
      traceDrawRouting('tool-selected', () => ({
        toolType,
        pointerPaneIndex: pointerPaneIndexRef.current,
      }))
    },
    [traceDrawRouting]
  )

  useEffect(() => {
    if (!chartRef.current || !mainSeriesRef.current) return
    if (effectiveDrawTools.length === 0) return
    if (!effectiveDrawTools.some((entry) => entry.pane === 'indicator')) return
    const rafId = window.requestAnimationFrame(() => {
      syncOwnersNow(effectiveDrawTools)

      const mainPaneIndex = (() => {
        try {
          return mainSeriesRef.current?.getPane().paneIndex() ?? 0
        } catch {
          return 0
        }
      })()

      const resolveRuntimeEntryForIndicator = (indicatorId: string) => {
        const normalizedIndicatorId = indicatorId.trim()
        if (!normalizedIndicatorId) return null

        const direct = indicatorRuntimeRef.current.get(normalizedIndicatorId)
        if (direct) {
          return direct
        }

        const normalizedLower = normalizedIndicatorId.toLowerCase()
        for (const [candidateId, runtimeEntry] of indicatorRuntimeRef.current.entries()) {
          if (candidateId.trim().toLowerCase() === normalizedLower) {
            return runtimeEntry
          }
        }
        return null
      }

      let reboundAny = false
      effectiveDrawTools.forEach((entry) => {
        if (entry.pane !== 'indicator') return
        if (typeof entry.indicatorId !== 'string' || entry.indicatorId.trim().length === 0) return
        const persistedToolCount = Array.isArray(entry.snapshot?.tools)
          ? entry.snapshot.tools.length
          : 0
        if (persistedToolCount <= 0) return

        const runtimeEntry = resolveRuntimeEntryForIndicator(entry.indicatorId)
        if (!runtimeEntry || runtimeEntry.errorMessage) return

        const runtimePaneIndex = resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex)
        if (!Number.isFinite(runtimePaneIndex) || runtimePaneIndex === mainPaneIndex) {
          return
        }

        const ownerId = toManualOwnerId(entry.id)
        const rebound = rebindOrAttachOwnerToPane(ownerId, entry, runtimePaneIndex)
        if (rebound) {
          reboundAny = true
        }
      })

      if (reboundAny) {
        syncOwnersNow(effectiveDrawTools)
      }
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [
    chartReady,
    paneSnapshot,
    paneLayout,
    dataVersion,
    indicatorRuntimeVersion,
    effectiveDrawTools,
    syncOwnersNow,
    rebindOrAttachOwnerToPane,
    chartRef,
    mainSeriesRef,
    indicatorRuntimeRef,
    toManualOwnerId,
    isOwnerAttached,
    hasOwnerTools,
  ])

  const handleClearManualTools = useCallback(() => {
    if (!activeManualOwnerId) return
    clearAll(activeManualOwnerId)
  }, [activeManualOwnerId, clearAll])

  const hasActiveOwnerTools = activeManualOwnerId ? hasOwnerTools(activeManualOwnerId) : false

  const activeOwnerVisibilityMode = activeManualOwnerId
    ? getOwnerVisibilityMode(activeManualOwnerId)
    : 'hide'

  const handleToggleAllManualVisibility = useCallback(() => {
    if (!activeManualOwnerId) return
    const targetVisible = getOwnerVisibilityMode(activeManualOwnerId) === 'show'
    setAllVisibility(activeManualOwnerId, targetVisible)
  }, [activeManualOwnerId, getOwnerVisibilityMode, setAllVisibility])

  const resolveManualToolCapability = useCallback(
    (toolType: ManualToolType) => {
      if (!activeManualOwnerId) return 'unknown'
      return getToolCapability(activeManualOwnerId, toolType)
    },
    [activeManualOwnerId, getToolCapability]
  )

  const resolveNonSelectableToolActive = useCallback(
    (toolType: ManualToolType) => {
      if (!activeManualOwnerId) return false
      return isNonSelectableToolActive(activeManualOwnerId, toolType)
    },
    [activeManualOwnerId, isNonSelectableToolActive]
  )

  const handleHideSelectedDrawings = useCallback(
    (ownerId?: string | null) => {
      const targetOwnerId = ownerId ?? activeManualOwnerId
      if (!targetOwnerId) return
      hideSelected(targetOwnerId)
    },
    [activeManualOwnerId, hideSelected]
  )

  const handleRemoveSelectedDrawings = useCallback(
    (ownerId?: string | null) => {
      const targetOwnerId = ownerId ?? activeManualOwnerId
      if (!targetOwnerId) return
      removeSelected(targetOwnerId)
    },
    [activeManualOwnerId, removeSelected]
  )

  return {
    activeManualOwnerId,
    hasActiveOwnerTools,
    activeOwnerVisibilityMode,
    resolveManualToolCapability,
    resolveNonSelectableToolActive,
    handleSelectManualTool,
    handleToggleAllManualVisibility,
    handleClearManualTools,
    handleHideSelectedDrawings,
    handleRemoveSelectedDrawings,
    resolveSelectedOwnerForPane,
  }
}
