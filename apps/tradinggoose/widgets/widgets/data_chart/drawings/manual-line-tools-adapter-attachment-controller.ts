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
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'
import {
  areSetsEqual,
  fromManualOwnerId,
  parseDoubleClickTool,
  parseLineToolExports,
  toManualOwnerId,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-utils'
import {
  type ManualOwnerSnapshot,
  decodeManualOwnerSnapshot,
  encodeManualOwnerSnapshot,
  normalizeManualOwnerSnapshot,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-snapshot'
import {
  registerAllManualTools,
  TEXT_EDITABLE_TOOL_TYPES,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-plugin-registry'
import {
  MANUAL_TOOL_TYPES,
  type ManualToolType,
} from '@/widgets/widgets/data_chart/drawings/manual-tool-types'
import {
  createLineToolsPlugin,
  type ILineToolsPlugin,
  type LineToolExport,
} from '@/widgets/widgets/data_chart/plugins/core'
import type { DrawToolsRef, IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

type ManualLineToolsAttachmentControllerParams = {
  chartRef: MutableRefObject<IChartApi | null>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  chartScopeKeyRef: MutableRefObject<string>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
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
  const seriesIdentityMap = new WeakMap<ISeriesApi<any>, string>()
  let seriesIdentityCounter = 1

  const getSeriesIdentity = (series: ISeriesApi<any>) => {
    const existing = seriesIdentityMap.get(series)
    if (existing) return existing
    const next = `s${seriesIdentityCounter++}`
    seriesIdentityMap.set(series, next)
    return next
  }

  const resolveOwnerTarget = (drawToolsRef: DrawToolsRef): ResolvedOwnerTarget | null => {
    const chart = params.chartRef.current
    const mainSeries = params.mainSeriesRef.current
    if (!chart || !mainSeries) return null

    if (drawToolsRef.pane === 'indicator') {
      if (!drawToolsRef.indicatorId) return null
      const runtimeEntry = params.indicatorRuntimeRef.current.get(drawToolsRef.indicatorId)
      if (!runtimeEntry?.paneAnchorSeries || !runtimeEntry.paneAnchorIdentity) return null
      return {
        pane: 'indicator',
        indicatorId: drawToolsRef.indicatorId,
        series: runtimeEntry.paneAnchorSeries,
        seriesAttachmentKey: `chart:${params.chartScopeKeyRef.current}:indicator:${drawToolsRef.indicatorId}:anchor:${runtimeEntry.paneAnchorIdentity}`,
      }
    }

    const mainSeriesIdentity = getSeriesIdentity(mainSeries)
    return {
      pane: 'price',
      series: mainSeries,
      seriesAttachmentKey: `chart:${params.chartScopeKeyRef.current}:price:${mainSeriesIdentity}`,
    }
  }

  const getPluginEntryForOwner = (ownerId: OwnerId): PluginContext | null => {
    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return null
    const pluginEntry = params.pluginsBySeriesAttachmentKeyRef.current.get(
      binding.seriesAttachmentKey
    )
    if (!pluginEntry) return null
    return { binding, pluginEntry }
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
  ) => {
    const parsed = decodeManualOwnerSnapshot(snapshot)
    if (parsed.length === 0) return
    if (!plugin.importLineTools(JSON.stringify(parsed))) return

    const ownerIds = params.ensureOwnerToolIds(ownerId)
    const ownerIdsByType = params.ensureOwnerToolIdsByType(ownerId)
    const ownerCapabilities = params.ensureOwnerCapabilities(ownerId)

    parsed.forEach((toolData) => {
      const importedTool = parseLineToolExports(plugin.getLineToolByID(toolData.id))[0]
      if (!importedTool) return

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
    pluginEntry.plugin.destroy()
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

    const pendingSnapshot = params.pendingOwnerSnapshotRef.current.get(ownerId)
    if (pendingSnapshot) {
      importOwnerSnapshot(ownerId, pluginEntry.plugin, pendingSnapshot)
      params.pendingOwnerSnapshotRef.current.delete(ownerId)
    }

    reconcileSelection(ownerId)
    params.bumpVersion()
  }

  const detachOwner = (ownerId: OwnerId, options?: DetachOptions) => {
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
      if (ownerIds && ownerIds.size > 0) {
        const ids = Array.from(ownerIds)
        pluginEntry.plugin.removeLineToolsById(ids)
        params.removeIdsFromOwnerState(ownerId, ids)
      }

      pluginEntry.owners.delete(ownerId)

      const currentCount =
        params.seriesAttachmentRefCountByKeyRef.current.get(binding.seriesAttachmentKey) ?? 0
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
    const currentBinding = params.ownerBindingByIdRef.current.get(ownerId)
    const target = resolveOwnerTarget(drawToolsRef)
    const persistedSnapshot = normalizeManualOwnerSnapshot(drawToolsRef.snapshot)

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
      if (
        persistedSnapshot &&
        !params.pendingOwnerSnapshotRef.current.has(ownerId) &&
        (params.ownerToolIdsRef.current.get(ownerId)?.size ?? 0) === 0
      ) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, persistedSnapshot)
      }
      attachOwner(ownerId, drawToolsRef, target)
      return
    }

    if (currentBinding.seriesAttachmentKey !== target.seriesAttachmentKey) {
      const ownerSnapshot = exportOwnerSnapshot(ownerId)
      if (ownerSnapshot) {
        params.pendingOwnerSnapshotRef.current.set(ownerId, ownerSnapshot)
      }
      detachOwner(ownerId, { preserveCapabilities: true, preservePendingSnapshot: true })
      attachOwner(ownerId, drawToolsRef, target)
      reconcileSelection(ownerId)
      return
    }

    reconcileSelection(ownerId)
  }

  const syncOwners = (drawTools: DrawToolsRef[]) => {
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

  const teardownAll = () => {
    params.closeInlineTextEditor(true)

    params.ownerBindingByIdRef.current.forEach((_, ownerId) => {
      detachOwner(ownerId)
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
    params.pendingOwnerSnapshotRef.current.clear()
    params.bumpVersion()
  }

  return {
    getPluginEntryForOwner,
    reconcileSelection,
    exportOwnerSnapshot,
    syncOwners,
    detachOwner,
    teardownAll,
  }
}
