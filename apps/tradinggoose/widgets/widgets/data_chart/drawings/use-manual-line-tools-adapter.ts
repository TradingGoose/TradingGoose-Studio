'use client'

import { useEffect, useRef, useState } from 'react'
import type { IChartApi } from 'lightweight-charts'
import { createManualLineToolsAdapterActions } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-actions'
import { createManualLineToolsAttachmentController } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-attachment-controller'
import type {
  InlineTextEditorEntry,
  OwnerBinding,
  OwnerId,
  OwnerToolCapability,
  PluginEntry,
  SeriesAttachmentKey,
  UseManualLineToolsAdapterParams,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'
import {
  parseLineToolExports,
  toManualOwnerId,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-utils'
import { createInlineTextEditorController } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-inline-text-editor'
import { createOwnerStateHelpers } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-owner-state'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-snapshot'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/manual-tool-types'

export type {
  OwnerVisibilityMode,
  ToolCreateCapability,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'

let fallbackChartScopeCounter = 1

export const useManualLineToolsAdapter = ({
  chartRef,
  mainSeriesRef,
  chartReady,
  syncVersion,
  panelId,
  drawTools,
  indicatorRuntimeRef,
  indicatorRuntimeVersion,
  onActiveDrawToolsIdChange,
}: UseManualLineToolsAdapterParams) => {
  const [revision, setRevision] = useState(0)
  const fallbackChartScopeKeyRef = useRef<string | null>(null)
  const chartScopeKeyRef = useRef<string>('')
  const activeOwnerChangeRef = useRef(onActiveDrawToolsIdChange)
  const currentChartRef = useRef<IChartApi | null>(null)

  const pluginsBySeriesAttachmentKeyRef = useRef<Map<SeriesAttachmentKey, PluginEntry>>(new Map())
  const ownerBindingByIdRef = useRef<Map<OwnerId, OwnerBinding>>(new Map())
  const seriesAttachmentRefCountByKeyRef = useRef<Map<SeriesAttachmentKey, number>>(new Map())
  const ownerToolIdsRef = useRef<Map<OwnerId, Set<string>>>(new Map())
  const ownerToolIdsByTypeRef = useRef<Map<OwnerId, Map<ManualToolType, string>>>(new Map())
  const ownerSelectedIdsRef = useRef<Map<OwnerId, Set<string>>>(new Map())
  const ownerCapabilitiesRef = useRef<Map<OwnerId, Map<ManualToolType, OwnerToolCapability>>>(
    new Map()
  )
  const pendingOwnerSnapshotRef = useRef<Map<OwnerId, ManualOwnerSnapshot>>(new Map())
  const activeInlineTextEditorRef = useRef<InlineTextEditorEntry | null>(null)

  useEffect(() => {
    activeOwnerChangeRef.current = onActiveDrawToolsIdChange
  }, [onActiveDrawToolsIdChange])

  if (!fallbackChartScopeKeyRef.current) {
    fallbackChartScopeKeyRef.current = `chart-${fallbackChartScopeCounter++}`
  }

  chartScopeKeyRef.current = panelId ?? fallbackChartScopeKeyRef.current

  const bumpVersion = () => {
    setRevision((prev) => prev + 1)
  }

  const ownerStateHelpersRef = useRef(
    createOwnerStateHelpers({
      ownerToolIdsRef,
      ownerToolIdsByTypeRef,
      ownerSelectedIdsRef,
      ownerCapabilitiesRef,
      pendingOwnerSnapshotRef,
    })
  )

  const reconcileSelectionRef = useRef<(ownerId: OwnerId) => void>(() => {})

  const inlineTextEditorControllerRef = useRef<
    ReturnType<typeof createInlineTextEditorController> | undefined
  >(undefined)

  if (!inlineTextEditorControllerRef.current) {
    inlineTextEditorControllerRef.current = createInlineTextEditorController({
      chartRef,
      activeInlineTextEditorRef,
      parseLineToolExports,
      reconcileSelection: (ownerId) => reconcileSelectionRef.current(ownerId),
      bumpVersion,
    })
  }

  const attachmentControllerRef = useRef<
    ReturnType<typeof createManualLineToolsAttachmentController> | undefined
  >(undefined)

  if (!attachmentControllerRef.current) {
    attachmentControllerRef.current = createManualLineToolsAttachmentController({
      chartRef,
      mainSeriesRef,
      chartScopeKeyRef,
      activeOwnerChangeRef,
      pluginsBySeriesAttachmentKeyRef,
      ownerBindingByIdRef,
      seriesAttachmentRefCountByKeyRef,
      ownerToolIdsRef,
      ownerToolIdsByTypeRef,
      ownerSelectedIdsRef,
      ownerCapabilitiesRef,
      pendingOwnerSnapshotRef,
      activeInlineTextEditorRef,
      ensureOwnerToolIds: ownerStateHelpersRef.current.ensureOwnerToolIds,
      ensureOwnerToolIdsByType: ownerStateHelpersRef.current.ensureOwnerToolIdsByType,
      ensureOwnerCapabilities: ownerStateHelpersRef.current.ensureOwnerCapabilities,
      removeIdsFromOwnerState: ownerStateHelpersRef.current.removeIdsFromOwnerState,
      clearOwnerState: ownerStateHelpersRef.current.clearOwnerState,
      openInlineTextEditor: inlineTextEditorControllerRef.current.openInlineTextEditor,
      closeInlineTextEditor: inlineTextEditorControllerRef.current.closeInlineTextEditor,
      bumpVersion,
    })
  }

  reconcileSelectionRef.current = attachmentControllerRef.current.reconcileSelection

  const actionsControllerRef = useRef<
    ReturnType<typeof createManualLineToolsAdapterActions> | undefined
  >(undefined)

  if (!actionsControllerRef.current) {
    actionsControllerRef.current = createManualLineToolsAdapterActions({
      getPluginEntryForOwner: attachmentControllerRef.current.getPluginEntryForOwner,
      reconcileSelection: attachmentControllerRef.current.reconcileSelection,
      exportOwnerSnapshot: attachmentControllerRef.current.exportOwnerSnapshot,
      ownerBindingByIdRef,
      ownerToolIdsRef,
      ownerToolIdsByTypeRef,
      ownerSelectedIdsRef,
      ownerCapabilitiesRef,
      pendingOwnerSnapshotRef,
      mainSeriesRef,
      indicatorRuntimeRef,
      ensureOwnerToolIds: ownerStateHelpersRef.current.ensureOwnerToolIds,
      ensureOwnerToolIdsByType: ownerStateHelpersRef.current.ensureOwnerToolIdsByType,
      ensureOwnerCapability: ownerStateHelpersRef.current.ensureOwnerCapability,
      removeIdsFromOwnerState: ownerStateHelpersRef.current.removeIdsFromOwnerState,
      bumpVersion,
    })
  }

  const chartInstance = chartRef.current
  const mainSeriesInstance = mainSeriesRef.current

  useEffect(() => {
    if (currentChartRef.current && currentChartRef.current !== chartInstance) {
      attachmentControllerRef.current?.teardownAll()
    }
    currentChartRef.current = chartInstance
  }, [chartReady, chartInstance])

  useEffect(() => {
    return () => {
      attachmentControllerRef.current?.teardownAll()
    }
  }, [])

  useEffect(() => {
    let rafId: number | null = null
    let attempts = 0
    const maxAttempts = 60

    const runSync = () => {
      const chartReadyNow = Boolean(chartRef.current)
      const seriesReadyNow = Boolean(mainSeriesRef.current)
      if (!chartReadyNow || !seriesReadyNow) {
        attempts += 1
        if (attempts >= maxAttempts) return
        rafId = window.requestAnimationFrame(runSync)
        return
      }

      attachmentControllerRef.current?.syncOwners(drawTools)
      // One trailing sync after readiness helps import snapshots after style/series settle.
      rafId = window.requestAnimationFrame(() => {
        if (!chartRef.current || !mainSeriesRef.current) return
        attachmentControllerRef.current?.syncOwners(drawTools)
      })
    }

    runSync()

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId)
      }
    }
  }, [
    chartReady,
    drawTools,
    indicatorRuntimeVersion,
    syncVersion,
    chartInstance,
    mainSeriesInstance,
  ])

  return {
    revision,
    teardownAll: attachmentControllerRef.current.teardownAll,
    syncOwnersNow: attachmentControllerRef.current.syncOwners,
    toManualOwnerId,
    startManualTool: actionsControllerRef.current.startManualTool,
    toggleManualTool: actionsControllerRef.current.toggleManualTool,
    removeSelected: actionsControllerRef.current.removeSelected,
    hideSelected: actionsControllerRef.current.hideSelected,
    clearAll: actionsControllerRef.current.clearAll,
    hasOwnerTools: actionsControllerRef.current.hasOwnerTools,
    getOwnerSnapshot: actionsControllerRef.current.getOwnerSnapshot,
    isOwnerAttached: attachmentControllerRef.current.isOwnerAttached,
    getOwnerVisibilityMode: actionsControllerRef.current.getOwnerVisibilityMode,
    setAllVisibility: actionsControllerRef.current.setAllVisibility,
    getToolCapability: actionsControllerRef.current.getToolCapability,
    isNonSelectableToolActive: actionsControllerRef.current.isNonSelectableToolActive,
    hasSelectedManualDrawingsInPane: actionsControllerRef.current.hasSelectedManualDrawingsInPane,
    getSelectedCount: actionsControllerRef.current.getSelectedCount,
    reconcileSelection: attachmentControllerRef.current.reconcileSelection,
  }
}
