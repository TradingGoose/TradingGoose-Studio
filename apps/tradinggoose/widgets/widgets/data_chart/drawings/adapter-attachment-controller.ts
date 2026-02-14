import type { MutableRefObject } from 'react'
import type { IChartApi, ISeriesApi } from 'lightweight-charts'
import type {
  ClearOwnerStateOptions,
  DetachOptions,
  InlineTextEditorEntry,
  OwnerBinding,
  OwnerId,
  OwnerToolCapability,
  PluginContext,
  PluginEntry,
  ResolvedOwnerTarget,
  SeriesAttachmentKey,
} from '@/widgets/widgets/data_chart/drawings/adapter-types'
import {
  areSetsEqual,
  fromManualOwnerId,
  parseDoubleClickTool,
  parseLineToolExports,
  toManualOwnerId,
} from '@/widgets/widgets/data_chart/drawings/adapter-utils'
import { createAttachmentControllerTargetResolvers } from '@/widgets/widgets/data_chart/drawings/attachment-controller-targets'
import {
  registerAllManualTools,
  TEXT_EDITABLE_TOOL_TYPES,
} from '@/widgets/widgets/data_chart/drawings/plugin-registry'
import {
  decodeManualOwnerSnapshot,
  encodeManualOwnerSnapshot,
  type ManualOwnerSnapshot,
  normalizeManualOwnerSnapshot,
} from '@/widgets/widgets/data_chart/drawings/snapshot'
import {
  MANUAL_TOOL_TYPES,
  type ManualToolType,
} from '@/widgets/widgets/data_chart/drawings/tool-types'
import {
  createLineToolsPlugin,
  type ILineToolsPlugin,
  type LineToolExport,
} from '@/widgets/widgets/data_chart/plugins/core'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

type ManualLineToolsAttachmentControllerParams = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  chartScopeKeyRef: MutableRefObject<string>
  activeOwnerChangeRef: MutableRefObject<((drawToolsId: string) => void) | undefined>
  pluginsBySeriesAttachmentKeyRef: MutableRefObject<Map<SeriesAttachmentKey, PluginEntry>>
  ownerBindingByIdRef: MutableRefObject<Map<OwnerId, OwnerBinding>>
  seriesAttachmentRefCountByKeyRef: MutableRefObject<Map<SeriesAttachmentKey, number>>
  ownerToolIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerToolIdsByTypeRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, string>>>
  ownerSelectedIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerCapabilitiesRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, OwnerToolCapability>>>
  pendingOwnerSnapshotRef: MutableRefObject<Map<OwnerId, ManualOwnerSnapshot>>
  activeInlineTextEditorRef: MutableRefObject<InlineTextEditorEntry | null>
  ensureOwnerToolIds: (ownerId: OwnerId) => Set<string>
  ensureOwnerToolIdsByType: (ownerId: OwnerId) => Map<ManualToolType, string>
  ensureOwnerCapabilities: (ownerId: OwnerId) => Map<ManualToolType, OwnerToolCapability>
  removeIdsFromOwnerState: (ownerId: OwnerId, ids: string[]) => void
  clearOwnerState: (ownerId: OwnerId, options?: ClearOwnerStateOptions) => void
  openInlineTextEditor: (params: {
    ownerId: OwnerId
    seriesAttachmentKey: SeriesAttachmentKey
    plugin: ILineToolsPlugin
    series: ISeriesApi<any>
    tool: LineToolExport<any>
  }) => void
  closeInlineTextEditor: (commit: boolean) => void
  bumpVersion: () => void
}

export const createManualLineToolsAttachmentController = (
  params: ManualLineToolsAttachmentControllerParams
) => {
  const ownerViewRefreshRafByOwner = new Map<OwnerId, number>()
  const {
    isSeriesOnChart,
    isSeriesReadyForViewUpdate,
    hasUsablePriceProjection,
    resolveRuntimePaneIndex,
    resolveIndicatorRuntime,
    resolveOwnerTarget,
    resolveIndicatorTargetForPane,
  } = createAttachmentControllerTargetResolvers({
    chartRef: params.chartRef,
    mainSeriesRef: params.mainSeriesRef,
    indicatorRuntimeRef: params.indicatorRuntimeRef,
    chartScopeKeyRef: params.chartScopeKeyRef,
  })

  const getPluginEntryForOwner = (ownerId: OwnerId): PluginContext | null => {
    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return null
    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(
      binding.seriesAttachmentKey
    )
    if (!pluginEntry) return null
    const chart = params.chartRef.current
    if (chart && !isSeriesOnChart(chart, pluginEntry.series)) {
      return null
    }
    return { binding, pluginEntry }
  }

  const cancelOwnerViewRefresh = (ownerId: OwnerId) => {
    const rafId = ownerViewRefreshRafByOwner.get(ownerId)
    if (typeof rafId === 'number') {
      window.cancelAnimationFrame(rafId)
      ownerViewRefreshRafByOwner.delete(ownerId)
    }
  }

  const scheduleOwnerViewRefresh = (ownerId: OwnerId) => {
    if (ownerViewRefreshRafByOwner.has(ownerId)) return
    const rafId = window.requestAnimationFrame(() => {
      ownerViewRefreshRafByOwner.delete(ownerId)
      refreshOwnerViews(ownerId)
    })
    ownerViewRefreshRafByOwner.set(ownerId, rafId)
  }

  const reconcileSelection = (ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) {
      params.ownerSelectedIdsRef.current.delete(ownerId)
      return
    }

    const selectedExports = parseLineToolExports(
      pluginContext.pluginEntry.plugin.getSelectedLineTools()
    )
    const ownerIds = params.ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const nextSelected = new Set<string>()
    selectedExports.forEach((tool) => {
      if (ownerIds.has(tool.id)) {
        nextSelected.add(tool.id)
      }
    })

    const previous = params.ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    if (!areSetsEqual(previous, nextSelected)) {
      if (nextSelected.size > 0) {
        params.ownerSelectedIdsRef.current.set(ownerId, nextSelected)
      } else {
        params.ownerSelectedIdsRef.current.delete(ownerId)
      }
      params.bumpVersion()
    }

    if (nextSelected.size > 0) {
      const drawToolsId = fromManualOwnerId(ownerId)
      if (drawToolsId) {
        params.activeOwnerChangeRef.current?.(drawToolsId)
      }
    }
  }

  const exportOwnerSnapshot = (ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) return null

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return null

    const exported: Array<LineToolExport<any>> = []
    ownerIds.forEach((id) => {
      const singleExport = parseLineToolExports(
        pluginContext.pluginEntry.plugin.getLineToolByID(id)
      )
      if (singleExport.length > 0) {
        exported.push(singleExport[0])
      }
    })

    return encodeManualOwnerSnapshot(exported)
  }

  const importOwnerSnapshot = (
    ownerId: OwnerId,
    plugin: ILineToolsPlugin,
    snapshot: ManualOwnerSnapshot
  ): number => {
    const parsed = decodeManualOwnerSnapshot(snapshot)
    if (parsed.length === 0) return 0
    if (!plugin.importLineTools(JSON.stringify(parsed))) return 0

    const ownerIds = params.ensureOwnerToolIds(ownerId)
    const ownerIdsByType = params.ensureOwnerToolIdsByType(ownerId)
    const ownerCapabilities = params.ensureOwnerCapabilities(ownerId)
    let importedCount = 0

    parsed.forEach((toolData) => {
      const importedTool = parseLineToolExports(plugin.getLineToolByID(toolData.id))[0]
      if (!importedTool) return

      importedCount += 1
      ownerIds.add(importedTool.id)

      const toolType = importedTool.toolType as ManualToolType
      if (!MANUAL_TOOL_TYPES.includes(toolType)) {
        return
      }

      const canEdit = importedTool.options?.editable !== false
      ownerCapabilities.set(toolType, {
        supportsCreate: 'supported',
        canEdit,
      })
      if (!canEdit) {
        ownerIdsByType.set(toolType, importedTool.id)
      }
    })

    return importedCount
  }

  const importPendingOwnerSnapshot = (ownerId: OwnerId, pluginEntry: PluginEntry) => {
    const pendingSnapshot = params.pendingOwnerSnapshotRef.current.get(ownerId)
    if (!pendingSnapshot) return false

    const importedCount = importOwnerSnapshot(ownerId, pluginEntry.plugin, pendingSnapshot)
    if (importedCount > 0) {
      params.pendingOwnerSnapshotRef.current.delete(ownerId)
      return true
    }
    return false
  }

  const refreshOwnerViews = (ownerId: OwnerId) => {
    const pluginContext = getPluginEntryForOwner(ownerId)
    if (!pluginContext) {
      cancelOwnerViewRefresh(ownerId)
      return
    }

    importPendingOwnerSnapshot(ownerId, pluginContext.pluginEntry)

    if (!isSeriesReadyForViewUpdate(pluginContext.pluginEntry.series)) {
      scheduleOwnerViewRefresh(ownerId)
      return
    }

    const ownerToolIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerToolIds || ownerToolIds.size === 0) {
      if (params.pendingOwnerSnapshotRef.current.has(ownerId)) {
        scheduleOwnerViewRefresh(ownerId)
      } else {
        cancelOwnerViewRefresh(ownerId)
      }
      return
    }

    pluginContext.pluginEntry.plugin.refreshLineToolViews(Array.from(ownerToolIds))
    cancelOwnerViewRefresh(ownerId)
  }

  const reconcileOwnersForSeries = (seriesAttachmentKey: SeriesAttachmentKey) => {
    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(seriesAttachmentKey)
    if (!pluginEntry) return
    pluginEntry.owners.forEach((ownerId) => {
      reconcileSelection(ownerId)
    })
  }

  const resolveToolOwnerInSeries = (
    seriesAttachmentKey: SeriesAttachmentKey,
    toolId: string
  ): OwnerId | null => {
    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(seriesAttachmentKey)
    if (!pluginEntry) return null

    for (const ownerId of pluginEntry.owners) {
      if (params.ownerToolIdsRef.current.get(ownerId)?.has(toolId)) {
        return ownerId
      }
    }

    return null
  }

  const destroyPluginEntry = (
    seriesAttachmentKey: SeriesAttachmentKey,
    pluginEntry: PluginEntry
  ) => {
    if (params.activeInlineTextEditorRef.current?.seriesAttachmentKey === seriesAttachmentKey) {
      params.closeInlineTextEditor(true)
    }
    pluginEntry.chartElement.removeEventListener('pointerup', pluginEntry.pointerUpHandler)
    window.removeEventListener('mouseup', pluginEntry.windowMouseUpHandler)
    pluginEntry.plugin.unsubscribeLineToolsAfterEdit(pluginEntry.afterEditHandler as any)
    pluginEntry.plugin.unsubscribeLineToolsDoubleClick(pluginEntry.doubleClickHandler as any)
    try {
      pluginEntry.plugin.destroy()
    } catch {
      // Ignore teardown races when chart/series are already disposed.
    }
    params.pluginsBySeriesAttachmentKeyRef.current.delete(seriesAttachmentKey)
    params.seriesAttachmentRefCountByKeyRef.current.delete(seriesAttachmentKey)
  }

  const createPluginEntry = (target: ResolvedOwnerTarget): PluginEntry | undefined => {
    const chart = params.chartRef.current
    if (!chart) return undefined

    const plugin = createLineToolsPlugin(chart, target.series)
    registerAllManualTools(plugin)

    const chartElement = chart.chartElement()
    const pointerUpHandler = () => {
      window.requestAnimationFrame(() => {
        reconcileOwnersForSeries(target.seriesAttachmentKey)
      })
    }
    const windowMouseUpHandler = () => {
      window.requestAnimationFrame(() => {
        reconcileOwnersForSeries(target.seriesAttachmentKey)
      })
    }
    const afterEditHandler = () => {
      reconcileOwnersForSeries(target.seriesAttachmentKey)
      params.bumpVersion()
    }
    const doubleClickHandler = (event: unknown) => {
      reconcileOwnersForSeries(target.seriesAttachmentKey)

      const selectedTool = parseDoubleClickTool(event)
      if (!selectedTool) return

      const toolType = selectedTool.toolType as ManualToolType
      if (!TEXT_EDITABLE_TOOL_TYPES.has(toolType)) return

      const ownerId = resolveToolOwnerInSeries(target.seriesAttachmentKey, selectedTool.id)
      if (!ownerId) return
      if ((selectedTool.options as { editable?: boolean } | undefined)?.editable === false) return
      params.openInlineTextEditor({
        ownerId,
        seriesAttachmentKey: target.seriesAttachmentKey,
        plugin,
        series: target.series,
        tool: selectedTool,
      })
    }

    chartElement.addEventListener('pointerup', pointerUpHandler)
    window.addEventListener('mouseup', windowMouseUpHandler)
    plugin.subscribeLineToolsAfterEdit(afterEditHandler as any)
    plugin.subscribeLineToolsDoubleClick(doubleClickHandler as any)

    const pluginEntry: PluginEntry = {
      plugin,
      series: target.series,
      chartElement,
      owners: new Set<OwnerId>(),
      pointerUpHandler,
      windowMouseUpHandler,
      afterEditHandler,
      doubleClickHandler,
    }

    params.pluginsBySeriesAttachmentKeyRef.current.set(target.seriesAttachmentKey, pluginEntry)
    return pluginEntry
  }

  const attachOwner = (
    ownerId: OwnerId,
    drawToolsRef: DrawToolsRef,
    target: ResolvedOwnerTarget
  ) => {
    cancelOwnerViewRefresh(ownerId)

    let pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(target.seriesAttachmentKey)
    if (!pluginEntry) {
      pluginEntry = createPluginEntry(target)
    }
    if (!pluginEntry) return

    const wasAlreadyBound = pluginEntry.owners.has(ownerId)
    if (!wasAlreadyBound) {
      pluginEntry.owners.add(ownerId)
      const currentCount =
        params.seriesAttachmentRefCountByKeyRef.current.get(target.seriesAttachmentKey) ?? 0
      params.seriesAttachmentRefCountByKeyRef.current.set(
        target.seriesAttachmentKey,
        currentCount + 1
      )
    }

    params.ownerBindingByIdRef.current.set(ownerId, {
      seriesAttachmentKey: target.seriesAttachmentKey,
      pane: drawToolsRef.pane,
      indicatorId: drawToolsRef.indicatorId,
    })

    importPendingOwnerSnapshot(ownerId, pluginEntry)

    reconcileSelection(ownerId)
    refreshOwnerViews(ownerId)
    params.bumpVersion()
  }

  const detachOwner = (ownerId: OwnerId, options?: DetachOptions) => {
    cancelOwnerViewRefresh(ownerId)

    if (params.activeInlineTextEditorRef.current?.ownerId === ownerId) {
      params.closeInlineTextEditor(true)
    }

    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    if (!binding) {
      params.clearOwnerState(ownerId, {
        clearCapabilities: options?.preserveCapabilities !== true,
        clearPending: options?.preservePendingSnapshot !== true,
      })
      return
    }

    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(
      binding.seriesAttachmentKey
    )
    if (pluginEntry) {
      const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
      const ids = ownerIds && ownerIds.size > 0 ? Array.from(ownerIds) : []
      const currentCount =
        params.seriesAttachmentRefCountByKeyRef.current.get(binding.seriesAttachmentKey) ?? 0

      // If this is the last owner on the series attachment, destroy the plugin entry directly.
      // This avoids an intermediate remove/update call while the chart may already be tearing down.
      if (currentCount <= 1) {
        pluginEntry.owners.delete(ownerId)
        destroyPluginEntry(binding.seriesAttachmentKey, pluginEntry)
        if (ids.length > 0) {
          params.removeIdsFromOwnerState(ownerId, ids)
        }
        params.ownerBindingByIdRef.current.delete(ownerId)
        params.clearOwnerState(ownerId, {
          clearCapabilities: options?.preserveCapabilities !== true,
          clearPending: options?.preservePendingSnapshot !== true,
        })
        params.bumpVersion()
        return
      }

      if (ownerIds && ownerIds.size > 0) {
        pluginEntry.plugin.removeLineToolsById(ids)
        params.removeIdsFromOwnerState(ownerId, ids)
      }

      pluginEntry.owners.delete(ownerId)

      const nextCount = Math.max(0, currentCount - 1)
      if (nextCount === 0) {
        destroyPluginEntry(binding.seriesAttachmentKey, pluginEntry)
      } else {
        params.seriesAttachmentRefCountByKeyRef.current.set(binding.seriesAttachmentKey, nextCount)
      }
    }

    params.ownerBindingByIdRef.current.delete(ownerId)
    params.clearOwnerState(ownerId, {
      clearCapabilities: options?.preserveCapabilities !== true,
      clearPending: options?.preservePendingSnapshot !== true,
    })
    params.bumpVersion()
  }

  const reconcileOwnerAttachment = (drawToolsRef: DrawToolsRef) => {
    const ownerId = toManualOwnerId(drawToolsRef.id)
    let currentBinding = params.ownerBindingByIdRef.current.get(ownerId)
    const chart = params.chartRef.current
    const currentPluginEntry = currentBinding
      ? (params.pluginsBySeriesAttachmentKeyRef.current.get(currentBinding.seriesAttachmentKey) ??
        null)
      : null
    const stableCurrentTarget = (() => {
      if (!currentBinding || !currentPluginEntry || !chart) return null
      if (!isSeriesOnChart(chart, currentPluginEntry.series)) return null

      const bindingMatchesRequestedOwner =
        currentBinding.pane === drawToolsRef.pane &&
        (currentBinding.pane !== 'indicator' ||
          (() => {
            if (typeof drawToolsRef.indicatorId !== 'string') return false
            const requestedIndicatorId = drawToolsRef.indicatorId.trim()
            if (!requestedIndicatorId) return false
            const currentIndicatorId = currentBinding.indicatorId?.trim() ?? ''
            if (!currentIndicatorId) return false
            return currentIndicatorId.toLowerCase() === requestedIndicatorId.toLowerCase()
          })())

      if (!bindingMatchesRequestedOwner) return null

      if (currentBinding.pane === 'price') {
        return {
          pane: 'price' as const,
          series: currentPluginEntry.series,
          seriesAttachmentKey: currentBinding.seriesAttachmentKey,
        }
      }

      const indicatorId =
        typeof drawToolsRef.indicatorId === 'string' ? drawToolsRef.indicatorId.trim() : ''
      if (!indicatorId) return null

      const runtime = resolveIndicatorRuntime(indicatorId)
      if (!runtime) {
        return {
          pane: 'indicator' as const,
          indicatorId,
          series: currentPluginEntry.series,
          seriesAttachmentKey: currentBinding.seriesAttachmentKey,
        }
      }
      const { runtimeEntry } = runtime

      const mainPaneIndex = (() => {
        try {
          return params.mainSeriesRef.current?.getPane().paneIndex() ?? 0
        } catch {
          return 0
        }
      })()
      const runtimePaneIndex = resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex)
      const currentPaneIndex = (() => {
        try {
          return currentPluginEntry.series.getPane().paneIndex()
        } catch {
          return null
        }
      })()
      if (currentPaneIndex === null || currentPaneIndex !== runtimePaneIndex) {
        return null
      }
      const chartPane =
        chart.panes().find((candidatePane) => candidatePane.paneIndex() === runtimePaneIndex) ??
        null
      const paneHasProjectedSeries =
        chartPane
          ?.getSeries()
          .some((series) => hasUsablePriceProjection(series, runtimePaneIndex)) ?? false
      if (
        paneHasProjectedSeries &&
        !hasUsablePriceProjection(currentPluginEntry.series, runtimePaneIndex)
      ) {
        return null
      }

      return {
        pane: 'indicator' as const,
        indicatorId,
        series: currentPluginEntry.series,
        seriesAttachmentKey: currentBinding.seriesAttachmentKey,
      }
    })()
    const target = stableCurrentTarget ?? resolveOwnerTarget(drawToolsRef)
    const persistedSnapshot = normalizeManualOwnerSnapshot(drawToolsRef.snapshot)

    if (
      currentBinding &&
      !params.pluginsBySeriesAttachmentKeyRef.current.has(currentBinding.seriesAttachmentKey)
    ) {
      if (persistedSnapshot && !params.pendingOwnerSnapshotRef.current.has(ownerId)) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      currentBinding = params.ownerBindingByIdRef.current.get(ownerId)
    }

    if (!target) {
      if (
        !currentBinding &&
        persistedSnapshot &&
        !params.pendingOwnerSnapshotRef.current.has(ownerId)
      ) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      if (currentBinding) {
        const ownerSnapshot = exportOwnerSnapshot(ownerId)
        if (ownerSnapshot) {
          params.pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
        }
        detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      }
      return
    }

    if (!currentBinding) {
      if (persistedSnapshot && !params.pendingOwnerSnapshotRef.current.has(ownerId)) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      attachOwner(ownerId, drawToolsRef, target)
      return
    }

    if (currentBinding.seriesAttachmentKey !== target.seriesAttachmentKey) {
      const ownerSnapshot = exportOwnerSnapshot(ownerId)
      if (ownerSnapshot) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
      } else if (persistedSnapshot) {
        // Rebind can happen after indicator series recreation where runtime export is unavailable.
        // Fall back to persisted snapshot so tools are re-imported on the new attachment.
        params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      attachOwner(ownerId, drawToolsRef, target)
      reconcileSelection(ownerId)
      return
    }

    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(
      currentBinding.seriesAttachmentKey
    )
    if (pluginEntry) {
      importPendingOwnerSnapshot(ownerId, pluginEntry)
    }

    if (pluginEntry && persistedSnapshot) {
      const runtimeSnapshot = exportOwnerSnapshot(ownerId)
      const runtimeToolCount = runtimeSnapshot?.tools.length ?? 0
      const persistedToolCount = persistedSnapshot.tools.length
      // Recover from runtime desync by restoring persisted snapshot when nothing is currently mounted.
      if (runtimeToolCount < persistedToolCount) {
        const importedCount = importOwnerSnapshot(ownerId, pluginEntry.plugin, persistedSnapshot)
        if (
          importedCount < persistedToolCount &&
          !params.pendingOwnerSnapshotRef.current.has(ownerId)
        ) {
          params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
        }
      }
    }

    reconcileSelection(ownerId)
    refreshOwnerViews(ownerId)
  }

  const syncOwners = (drawTools: DrawToolsRef[]) => {
    // Do not reconcile while chart/series refs are unresolved; teardown path handles chart disposal.
    if (!params.chartRef.current || !params.mainSeriesRef.current) {
      return
    }

    const nextOwnerIds = new Set(drawTools.map((entry) => toManualOwnerId(entry.id)))

    params.ownerBindingByIdRef.current.forEach((_, ownerId) => {
      if (!nextOwnerIds.has(ownerId)) {
        detachOwner(ownerId)
      }
    })

    drawTools.forEach((entry) => {
      reconcileOwnerAttachment(entry)
    })
  }

  const preserveOwnerSnapshotForRebind = (ownerId: OwnerId) => {
    const ownerSnapshot = exportOwnerSnapshot(ownerId)
    if (ownerSnapshot) {
      params.pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
    }
  }

  const reuseExistingOwnerTarget = (
    ownerId: OwnerId,
    drawToolsRef: DrawToolsRef,
    target: ResolvedOwnerTarget
  ) => {
    const existingBinding = params.ownerBindingByIdRef.current.get(ownerId)
    if (existingBinding?.seriesAttachmentKey !== target.seriesAttachmentKey) {
      return false
    }

    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(
      target.seriesAttachmentKey
    )
    if (!pluginEntry) {
      return false
    }

    params.ownerBindingByIdRef.current.set(ownerId, {
      seriesAttachmentKey: target.seriesAttachmentKey,
      pane: drawToolsRef.pane,
      indicatorId: target.indicatorId ?? drawToolsRef.indicatorId,
    })
    importPendingOwnerSnapshot(ownerId, pluginEntry)
    reconcileSelection(ownerId)
    refreshOwnerViews(ownerId)
    return true
  }

  const isOwnerAttached = (ownerId: OwnerId) => {
    return params.ownerBindingByIdRef.current.has(ownerId)
  }

  const toDrawToolsRefFromBinding = (drawToolsId: string, binding: OwnerBinding): DrawToolsRef =>
    binding.pane === 'indicator' && binding.indicatorId
      ? {
          id: drawToolsId,
          pane: 'indicator',
          indicatorId: binding.indicatorId,
        }
      : {
          id: drawToolsId,
          pane: 'price',
        }

  const rebindOwner = (ownerId: OwnerId) => {
    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    const drawToolsId = fromManualOwnerId(ownerId)
    if (!binding || !drawToolsId) return false

    const drawToolsRef = toDrawToolsRefFromBinding(drawToolsId, binding)
    const target = resolveOwnerTarget(drawToolsRef)
    if (!target) {
      return false
    }
    if (reuseExistingOwnerTarget(ownerId, drawToolsRef, target)) {
      return true
    }

    preserveOwnerSnapshotForRebind(ownerId)
    detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
    attachOwner(ownerId, drawToolsRef, target)
    return isOwnerAttached(ownerId)
  }

  const rebindOwnerToPane = (ownerId: OwnerId, paneIndex: number) => {
    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    const drawToolsId = fromManualOwnerId(ownerId)
    if (!binding || !drawToolsId) return false

    const drawToolsRef = toDrawToolsRefFromBinding(drawToolsId, binding)
    const target = resolveIndicatorTargetForPane(
      ownerId,
      binding.indicatorId,
      paneIndex,
      `pane-${paneIndex}`
    )
    if (!target) return false

    if (reuseExistingOwnerTarget(ownerId, drawToolsRef, target)) {
      return true
    }

    preserveOwnerSnapshotForRebind(ownerId)
    detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
    attachOwner(ownerId, drawToolsRef, target)
    return isOwnerAttached(ownerId)
  }

  const rebindOrAttachOwnerToPane = (
    ownerId: OwnerId,
    drawToolsRef: DrawToolsRef,
    paneIndex: number
  ) => {
    const target = resolveIndicatorTargetForPane(ownerId, drawToolsRef.indicatorId, paneIndex)
    if (!target) return false

    if (reuseExistingOwnerTarget(ownerId, drawToolsRef, target)) {
      return true
    }

    preserveOwnerSnapshotForRebind(ownerId)

    const hasBinding = params.ownerBindingByIdRef.current.has(ownerId)
    if (hasBinding) {
      detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
    }
    attachOwner(ownerId, drawToolsRef, target)
    return isOwnerAttached(ownerId)
  }

  const hasPendingIndicatorRestore = (drawTools: DrawToolsRef[]) => {
    const mainPaneIndex = (() => {
      try {
        return params.mainSeriesRef.current?.getPane().paneIndex() ?? 0
      } catch {
        return 0
      }
    })()

    for (const entry of drawTools) {
      if (entry.pane !== 'indicator') continue
      const snapshotTools = Array.isArray(entry.snapshot?.tools) ? entry.snapshot.tools : []
      if (snapshotTools.length === 0) continue

      const requestedIndicatorId =
        typeof entry.indicatorId === 'string' ? entry.indicatorId.trim() : ''
      if (!requestedIndicatorId) continue
      const runtime = resolveIndicatorRuntime(requestedIndicatorId)
      if (!runtime) continue
      const { runtimeEntry } = runtime
      if (runtimeEntry.errorMessage) continue

      const runtimePaneIndex = resolveRuntimePaneIndex(runtimeEntry, mainPaneIndex)
      if (!Number.isFinite(runtimePaneIndex) || runtimePaneIndex === mainPaneIndex) {
        continue
      }

      const ownerId = toManualOwnerId(entry.id)
      if (!isOwnerAttached(ownerId)) {
        return true
      }

      if (params.pendingOwnerSnapshotRef.current.has(ownerId)) {
        return true
      }

      const ownerToolIds = params.ownerToolIdsRef.current.get(ownerId)
      if (!ownerToolIds || ownerToolIds.size === 0) {
        return true
      }

      const pluginContext = getPluginEntryForOwner(ownerId)
      if (!pluginContext) {
        return true
      }

      let boundPaneIndex: number | null = null
      try {
        boundPaneIndex = pluginContext.pluginEntry.series.getPane().paneIndex()
      } catch {
        boundPaneIndex = null
      }
      if (boundPaneIndex === null || boundPaneIndex !== runtimePaneIndex) {
        return true
      }

      let mountedToolCount = 0
      ownerToolIds.forEach((toolId) => {
        const exported = parseLineToolExports(
          pluginContext.pluginEntry.plugin.getLineToolByID(toolId)
        )
        if (exported.length > 0) {
          mountedToolCount += 1
        }
      })
      if (mountedToolCount < snapshotTools.length) {
        return true
      }
      if (!isSeriesReadyForViewUpdate(pluginContext.pluginEntry.series)) {
        return true
      }
    }

    return false
  }

  const teardownAll = () => {
    ownerViewRefreshRafByOwner.forEach((rafId) => {
      window.cancelAnimationFrame(rafId)
    })
    ownerViewRefreshRafByOwner.clear()

    params.closeInlineTextEditor(true)

    // Capture latest runtime snapshots before destroying plugin entries.
    params.ownerBindingByIdRef.current.forEach((_, ownerId) => {
      preserveOwnerSnapshotForRebind(ownerId)
    })

    params.pluginsBySeriesAttachmentKeyRef.current.forEach((pluginEntry, seriesAttachmentKey) => {
      destroyPluginEntry(seriesAttachmentKey, pluginEntry)
    })

    params.ownerBindingByIdRef.current.clear()
    params.seriesAttachmentRefCountByKeyRef.current.clear()
    params.ownerToolIdsRef.current.clear()
    params.ownerToolIdsByTypeRef.current.clear()
    params.ownerSelectedIdsRef.current.clear()
    params.ownerCapabilitiesRef.current.clear()
    params.bumpVersion()
  }

  return {
    getPluginEntryForOwner,
    reconcileSelection,
    exportOwnerSnapshot,
    syncOwners,
    detachOwner,
    teardownAll,
    isOwnerAttached,
    rebindOwner,
    rebindOwnerToPane,
    rebindOrAttachOwnerToPane,
    hasPendingIndicatorRestore,
  }
}
