import type { MutableRefObject } from 'react'
import type { ISeriesApi } from 'lightweight-charts'
import type {
  OwnerBinding,
  OwnerId,
  OwnerToolCapability,
  OwnerVisibilityMode,
  PluginContext,
  ToolCreateCapability,
} from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-types'
import type { ManualOwnerSnapshot } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-snapshot'
import { parseLineToolExports } from '@/widgets/widgets/data_chart/drawings/manual-line-tools-adapter-utils'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/manual-tool-types'
import type { IndicatorRuntimeEntry } from '@/widgets/widgets/data_chart/types'

type ManualLineToolsAdapterActionsParams = {
  getPluginEntryForOwner: (ownerId: OwnerId) => PluginContext | null
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
  const startManualTool = (type: ManualToolType, ownerId: OwnerId) => {
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) {
      console.warn('[manual-line-tools] startManualTool skipped: owner is not attached', {
        ownerId,
        type,
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
        pluginContext.pluginEntry.plugin.removeLineToolsById([trackedId])
        params.removeIdsFromOwnerState(ownerId, [trackedId])
      }
    }

    const createdId = pluginContext.pluginEntry.plugin.addLineTool(type, [])
    if (!createdId) {
      console.warn('[manual-line-tools] addLineTool failed', {
        ownerId,
        type,
        pane: pluginContext.binding.pane,
        indicatorId: pluginContext.binding.indicatorId ?? null,
        seriesAttachmentKey: pluginContext.binding.seriesAttachmentKey,
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
    const selectedIds = params.ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    const removable = Array.from(selectedIds).filter((id) => ownerIds.has(id))
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
    const selectedIds = params.ownerSelectedIdsRef.current.get(ownerId) ?? new Set<string>()
    const hidAny = Array.from(selectedIds).reduce((updated, id) => {
      if (!ownerIds.has(id)) return updated
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
    const pluginContext = params.getPluginEntryForOwner(ownerId)
    if (!pluginContext) return

    const ownerIds = params.ownerToolIdsRef.current.get(ownerId)
    if (!ownerIds || ownerIds.size === 0) return
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
    const exported = params.exportOwnerSnapshot(ownerId)
    if (exported) return exported
    return params.pendingOwnerSnapshotRef.current.get(ownerId) ?? null
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
    const selected = params.ownerSelectedIdsRef.current.get(ownerId)
    if (!selected || selected.size === 0) return false

    const binding = params.ownerBindingByIdRef.current.get(ownerId)
    if (!binding) return false

    if (binding.pane === 'price') {
      const mainSeries = params.mainSeriesRef.current
      if (!mainSeries) return false
      return mainSeries.getPane().paneIndex() === paneIndex
    }

    if (!binding.indicatorId) return false
    const runtimeEntry = params.indicatorRuntimeRef.current.get(binding.indicatorId)
    if (!runtimeEntry?.pane) return false
    return runtimeEntry.pane.paneIndex() === paneIndex
  }

  const getSelectedCount = (ownerId: OwnerId) => {
    return params.ownerSelectedIdsRef.current.get(ownerId)?.size ?? 0
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
