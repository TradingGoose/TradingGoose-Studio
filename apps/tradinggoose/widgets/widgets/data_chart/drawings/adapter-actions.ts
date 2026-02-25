import type { MutableRefObject } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import type {
  OwnerBinding,
  OwnerId,
  OwnerToolCapability,
  OwnerVisibilityMode,
  PluginContext,
  ToolCreateCapability,
} from '@/widgets/widgets/data_chart/drawings/adapter-types'
import { parseLineToolExports } from '@/widgets/widgets/data_chart/drawings/adapter-utils'
import {
  type ManualOwnerSnapshot,
  mergeManualOwnerSnapshots,
} from '@/widgets/widgets/data_chart/drawings/snapshot'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'
import type { IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

type ManualLineToolsAdapterActionsParams = {
  getPluginEntryForOwner: (ownerId: OwnerId) => PluginContext | null
  rebindOwner: (ownerId: OwnerId) => boolean
  reconcileSelection: (ownerId: OwnerId) => void
  exportOwnerSnapshot: (ownerId: OwnerId) => ManualOwnerSnapshot | null
  ownerBindingByIdRef: MutableRefObject<Map<OwnerId, OwnerBinding>>
  ownerToolIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerToolIdsByTypeRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, string>>>
  ownerSelectedIdsRef: MutableRefObject<Map<OwnerId, Set<string>>>
  ownerCapabilitiesRef: MutableRefObject<Map<OwnerId, Map<ManualToolType, OwnerToolCapability>>>
  pendingOwnerSnapshotRef: MutableRefObject<Map<OwnerId, ManualOwnerSnapshot>>
  mainSeriesRef: MutableRefObject<ISeriesApi<any> | null>
  indicatorRuntimeRef: MutableRefObject<Map<string, IndicatorRuntimeEntry>>
  ensureOwnerToolIds: (ownerId: OwnerId) => Set<string>
  ensureOwnerToolIdsByType: (ownerId: OwnerId) => Map<ManualToolType, string>
  ensureOwnerCapability: (ownerId: OwnerId, type: ManualToolType) => OwnerToolCapability
  removeIdsFromOwnerState: (ownerId: OwnerId, ids: string[]) => void
  bumpVersion: () => void
}

export const createManualLineToolsAdapterActions = (
  params: ManualLineToolsAdapterActionsParams
) => {
  const resolveSelectedIds = (ownerId: OwnerId, pluginContext?: PluginContext | null) => {
    const resolvedPluginContext = pluginContext ?? params.getPluginEntryForOwner(ownerId)
    if (!resolvedPluginContext) {
      return params.ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    }

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const selectedExports = parseLineToolExports(
      resolvedPluginContext.pluginEntry.plugin.getSelectedLineTools()
    )
    const selectedIds = new Set<string>()
    selectedExports.forEach((tool) => {
      if (ownerIds.has(tool.id)) {
        selectedIds.add(tool.id)
      }
    })

    if (
      selectedIds.size === 0 &&
      selectedExports.length > 0 &&
      resolvedPluginContext.pluginEntry.owners.size === 1 &&
      resolvedPluginContext.pluginEntry.owners.has(ownerId)
    ) {
      // Fallback: when owner-id tracking is stale after rebind/import, but this plugin entry
      // is exclusively owned by this owner, treat selected tools as belonging to this owner.
      selectedExports.forEach((tool) => {
        selectedIds.add(tool.id)
      })
    }

    return selectedIds
  }

  const startManualTool = (type: ManualToolType, ownerId: OwnerId) => {
    const resolvePluginContext = (allowRebind: boolean) => {
      const existing = params.getPluginEntryForOwner(ownerId)
      if (existing) {
        return {
          pluginContext: existing,
          rebindAttempted: false,
        }
      }
      if (!allowRebind) {
        return {
          pluginContext: null,
          rebindAttempted: false,
        }
      }
      const rebound = params.rebindOwner(ownerId)
      return {
        pluginContext: rebound ? params.getPluginEntryForOwner(ownerId) : null,
        rebindAttempted: true,
      }
    }

    const { pluginContext: initialPluginContext, rebindAttempted: rebindMissingContextAttempted } =
      resolvePluginContext(true)
    if (!initialPluginContext) {
      console.warn('[manual-line-tools] startManualTool skipped: owner is not attached', {
        ownerId,
        type,
        rebindAttempted: rebindMissingContextAttempted,
      })
      return false
    }

    const capability = params.ensureOwnerCapability(ownerId, type)
    if (capability.supportsCreate === 'unsupported') {
      return false
    }

    if (capability.canEdit === false) {
      const byType = params.ensureOwnerToolIdsByType(ownerId)
      const trackedId = byType.get(type)
      if (trackedId) {
        initialPluginContext.pluginEntry.plugin.removeLineToolsById([trackedId])
        params.removeIdsFromOwnerState(ownerId, [trackedId])
      }
    }

    let pluginContext = initialPluginContext
    let createdId = pluginContext.pluginEntry.plugin.addLineTool(type, [])
    let rebindFailedCreateAttempted = false
    if (!createdId) {
      rebindFailedCreateAttempted = true
      if (params.rebindOwner(ownerId)) {
        const reboundPluginContext = params.getPluginEntryForOwner(ownerId)
        if (reboundPluginContext) {
          pluginContext = reboundPluginContext
          createdId = pluginContext.pluginEntry.plugin.addLineTool(type, [])
        }
      }
    }
    if (!createdId) {
      console.warn('[manual-line-tools] addLineTool failed', {
        ownerId,
        type,
        pane: pluginContext.binding.pane,
        indicatorId: pluginContext.binding.indicatorId ?? null,
        seriesAttachmentKey: pluginContext.binding.seriesAttachmentKey,
        rebindAttempted: rebindMissingContextAttempted || rebindFailedCreateAttempted,
      })
      if (capability.supportsCreate !== 'unknown') {
        capability.supportsCreate = 'unknown'
        params.bumpVersion()
      }
      return false
    }

    capability.supportsCreate = 'supported'

    const ownerIds = params.ensureOwnerToolIds(ownerId)
    ownerIds.add(createdId)

    const createdExport = parseLineToolExports(
      pluginContext.pluginEntry.plugin.getLineToolByID(createdId)
    )[0]
    const canEdit = createdExport?.options?.editable !== false
    capability.canEdit = canEdit

    const byType = params.ensureOwnerToolIdsByType(ownerId)
    if (canEdit) {
      byType.delete(type)
    } else {
      byType.set(type, createdId)
    }

    params.reconcileSelection(ownerId)
    params.bumpVersion()
    return true
  }

  const toggleManualTool = (type: ManualToolType, ownerId: OwnerId) => {
    const capability = params.ensureOwnerCapability(ownerId, type)
    if (capability.canEdit === false) {
      const pluginContext = params.getPluginEntryForOwner(ownerId)
      const trackedId = params.ownerToolIdsByTypeRef.current.get(ownerId)?.get(type)
      if (pluginContext && trackedId) {
        pluginContext.pluginEntry.plugin.removeLineToolsById([trackedId])
        params.removeIdsFromOwnerState(ownerId, [trackedId])
        params.reconcileSelection(ownerId)
        params.bumpVersion()
        return true
      }
    }
    return startManualTool(type, ownerId)
  }

  const removeSelected = (ownerId: OwnerId) => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const selectedIds = resolveSelectedIds(ownerId, pluginContext)
    const removable =
      ownerIds.size > 0
        ? Array.from(selectedIds).filter((id) => ownerIds.has(id))
        : Array.from(selectedIds)
    if (removable.length === 0) return

    pluginContext.pluginEntry.plugin.removeLineToolsById(removable)
    params.removeIdsFromOwnerState(ownerId, removable)
    params.reconcileSelection(ownerId)
    params.bumpVersion()
  }

  const hideSelected = (ownerId: OwnerId) => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId) ?? new Set<string>()
    const selectedIds = resolveSelectedIds(ownerId, pluginContext)
    const hidAny = Array.from(selectedIds).reduce((updated, id) => {
      if (ownerIds.size > 0 && !ownerIds.has(id)) return updated
      const toolExport = parseLineToolExports(
        pluginContext.pluginEntry.plugin.getLineToolByID(id)
      )[0]
      if (!toolExport) return updated
      pluginContext.pluginEntry.plugin.applyLineToolOptions({
        ...toolExport,
        options: {
          ...toolExport.options,
          visible: false,
        },
      })
      return true
    }, false)

    if (!hidAny) return

    params.reconcileSelection(ownerId)
    params.bumpVersion()
  }

  const clearAll = (ownerId: OwnerId) => {
    const hadPendingSnapshot = params.pendingOwnerSnapshotRef.current.delete(ownerId)
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) {
      if (hadPendingSnapshot) {
        params.bumpVersion()
      }
      return
    }

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) {
      if (hadPendingSnapshot) {
        params.bumpVersion()
      }
      return
    }
    const ids = Array.from(ownerIds)
    pluginContext.pluginEntry.plugin.removeLineToolsById(ids)
    params.removeIdsFromOwnerState(ownerId, ids)
    params.reconcileSelection(ownerId)
    params.bumpVersion()
  }

  const hasOwnerTools = (ownerId: OwnerId) => {
    return (params.ownerToolIdsRef.current.get(ownerId)?.size ?? 0) > 0
  }

  const getOwnerSnapshot = (ownerId: OwnerId) => {
    const pending = params.pendingOwnerSnapshotRef.current.get(ownerId) ?? null
    const exported = params.exportOwnerSnapshot(ownerId)
    return mergeManualOwnerSnapshots(pending, exported)
  }

  const getOwnerVisibilityMode = (ownerId: OwnerId): OwnerVisibilityMode => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) return 'hide'

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return 'hide'

    let hasHidden = false
    for (const id of ownerIds) {
      const toolExport = parseLineToolExports(
        pluginContext.pluginEntry.plugin.getLineToolByID(id)
      )[0]
      if (!toolExport) continue
      if (toolExport.options?.visible === false) {
        hasHidden = true
        break
      }
    }

    return hasHidden ? 'show' : 'hide'
  }

  const setAllVisibility = (ownerId: OwnerId, visible: boolean) => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return

    let updated = false
    ownerIds.forEach((id) => {
      const toolExport = parseLineToolExports(
        pluginContext.pluginEntry.plugin.getLineToolByID(id)
      )[0]
      if (!toolExport) return
      const currentlyVisible = toolExport.options?.visible !== false
      if (currentlyVisible === visible) return

      pluginContext.pluginEntry.plugin.applyLineToolOptions({
        ...toolExport,
        options: {
          ...toolExport.options,
          visible,
        },
      })
      updated = true
    })

    if (!updated) return

    params.reconcileSelection(ownerId)
    params.bumpVersion()
  }

  const getToolCapability = (ownerId: OwnerId, type: ManualToolType): ToolCreateCapability => {
    return params.ownerCapabilitiesRef.current.get(ownerId)?.get(type)?.supportsCreate ?? 'unknown'
  }

  const isNonSelectableToolActive = (ownerId: OwnerId, type: ManualToolType) => {
    const capability = params.ownerCapabilitiesRef.current.get(ownerId)?.get(type)
    if (!capability || capability.canEdit !== false) return false
    return params.ownerToolIdsByTypeRef.current.get(ownerId)?.has(type) ?? false
  }

  const hasSelectedManualDrawingsInPane = (ownerId: OwnerId, paneIndex: number) => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    const selected = resolveSelectedIds(ownerId, pluginContext)
    if (!selected || selected.size === 0) return false

    if (pluginContext) {
      try {
        return pluginContext.pluginEntry.series.getPane().paneIndex() === paneIndex
      } catch {
        // Fall through to binding/runtime checks below.
      }
    }

    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return false
    if (binding.pane === 'price') {
      const mainSeries = params.mainSeriesRef.current
      if (!mainSeries) return false
      return mainSeries.getPane().paneIndex() === paneIndex
    }

    if (!binding.indicatorId) return false
    const runtimeEntry = params.indicatorRuntimeRef.current.get(binding.indicatorId)
    if (!runtimeEntry) return false
    if (runtimeEntry.pane) {
      return runtimeEntry.pane.paneIndex() === paneIndex
    }
    if (runtimeEntry.paneIndex === paneIndex) {
      return true
    }
    return false
  }

  const getSelectedCount = (ownerId: OwnerId) => {
    return resolveSelectedIds(ownerId).size
  }

  return {
    startManualTool,
    toggleManualTool,
    removeSelected,
    hideSelected,
    clearAll,
    hasOwnerTools,
    getOwnerSnapshot,
    getOwnerVisibilityMode,
    setAllVisibility,
    getToolCapability,
    isNonSelectableToolActive,
    hasSelectedManualDrawingsInPane,
    getSelectedCount,
  }
}
