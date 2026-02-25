import type {
  ClearOwnerStateOptions,
  OwnerId,
  OwnerStateRefs,
  OwnerToolCapability,
} from '@/widgets/widgets/data_chart/drawings/adapter-types'
import type { ManualToolType } from '@/widgets/widgets/data_chart/drawings/tool-types'

export const createOwnerStateHelpers = (refs: OwnerStateRefs) => {
  const ensureOwnerToolIds = (ownerId: OwnerId) => {
    const existing = refs.ownerToolIdsRef.current.get(ownerId)
    if (existing) return existing
    const next = new Set<string>()
    refs.ownerToolIdsRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerToolIdsByType = (ownerId: OwnerId) => {
    const existing = refs.ownerToolIdsByTypeRef.current.get(ownerId)
    if (existing) return existing
    const next = new Map<ManualToolType, string>()
    refs.ownerToolIdsByTypeRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerCapabilities = (ownerId: OwnerId) => {
    const existing = refs.ownerCapabilitiesRef.current.get(ownerId)
    if (existing) return existing
    const next = new Map<ManualToolType, OwnerToolCapability>()
    refs.ownerCapabilitiesRef.current.set(ownerId, next)
    return next
  }

  const ensureOwnerCapability = (ownerId: OwnerId, type: ManualToolType) => {
    const capabilities = ensureOwnerCapabilities(ownerId)
    const existing = capabilities.get(type)
    if (existing) return existing
    const next: OwnerToolCapability = { supportsCreate: 'unknown', canEdit: null }
    capabilities.set(type, next)
    return next
  }

  const removeIdsFromOwnerState = (ownerId: OwnerId, ids: string[]) => {
    if (ids.length === 0) return

    const ownerIds = refs.ownerToolIdsRef.current.get(ownerId)
    if (ownerIds) {
      ids.forEach((id) => ownerIds.delete(id))
      if (ownerIds.size === 0) {
        refs.ownerToolIdsRef.current.delete(ownerId)
      }
    }

    const idsToRemove = new Set(ids)
    const ownerIdsByType = refs.ownerToolIdsByTypeRef.current.get(ownerId)
    if (ownerIdsByType) {
      for (const [toolType, trackedId] of ownerIdsByType.entries()) {
        if (idsToRemove.has(trackedId)) {
          ownerIdsByType.delete(toolType)
        }
      }
      if (ownerIdsByType.size === 0) {
        refs.ownerToolIdsByTypeRef.current.delete(ownerId)
      }
    }

    const selected = refs.ownerSelectedIdsRef.current.get(ownerId)
    if (selected) {
      ids.forEach((id) => selected.delete(id))
      if (selected.size === 0) {
        refs.ownerSelectedIdsRef.current.delete(ownerId)
      }
    }
  }

  const clearOwnerState = (ownerId: OwnerId, options?: ClearOwnerStateOptions) => {
    refs.ownerToolIdsRef.current.delete(ownerId)
    refs.ownerToolIdsByTypeRef.current.delete(ownerId)
    refs.ownerSelectedIdsRef.current.delete(ownerId)
    if (options?.clearCapabilities !== false) {
      refs.ownerCapabilitiesRef.current.delete(ownerId)
    }
    if (options?.clearPending !== false) {
      refs.pendingOwnerSnapshotRef.current.delete(ownerId)
    }
  }

  return {
    ensureOwnerToolIds,
    ensureOwnerToolIdsByType,
    ensureOwnerCapabilities,
    ensureOwnerCapability,
    removeIdsFromOwnerState,
    clearOwnerState,
  }
}
