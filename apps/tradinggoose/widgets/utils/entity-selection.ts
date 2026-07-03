import { useEffect } from 'react'
import type { PairColor } from '@/widgets/pair-colors'

export interface EntitySelectionState {
  selectedEntityId: string | null
}

const normalizeEntityId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveEntityId(
  key: string,
  {
    params,
    pairContext,
  }: {
    params?: Record<string, unknown> | null
    pairContext?: Record<string, unknown> | null
  }
): string | null {
  if (pairContext) {
    const value = Object.hasOwn(pairContext, key) ? pairContext[key] : null
    return typeof value === 'string' ? normalizeEntityId(value) : null
  }

  const value = params?.[key]
  return typeof value === 'string' ? normalizeEntityId(value) : null
}

/**
 * Shared dashboard entity selection policy:
 * - a non-empty requested id is authoritative and resolves to null if absent;
 * - an empty requested id may use a fallback/default when the caller allows it;
 * - linked color-pair widgets pass useDefaultEntity=false, so they never auto-claim.
 */
export function resolveEntityIdFromList({
  requestedEntityId,
  fallbackEntityId,
  entityIds,
  useDefaultEntity = true,
}: {
  requestedEntityId?: string | null
  fallbackEntityId?: string | null
  entityIds: readonly string[]
  useDefaultEntity?: boolean
}): string | null {
  const requested = normalizeEntityId(requestedEntityId)
  if (requested) return entityIds.includes(requested) ? requested : null

  const fallback = normalizeEntityId(fallbackEntityId)
  if (fallback && entityIds.includes(fallback)) return fallback

  return useDefaultEntity ? (entityIds[0] ?? null) : null
}

export function readEntitySelectionState(options: {
  params?: Record<string, unknown> | null
  pairContext?: Record<string, unknown> | null
  entityIdKey: string
}): EntitySelectionState {
  return {
    selectedEntityId: resolveEntityId(options.entityIdKey, {
      params: options.params,
      pairContext: options.pairContext,
    }),
  }
}

export function usePersistResolvedEntityId({
  entityId,
  entityIdKey,
  onWidgetParamsChange,
  pairColor = 'gray',
  params,
}: {
  entityId?: string | null
  entityIdKey: string
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  pairColor?: PairColor
  params?: Record<string, unknown> | null
}) {
  useEffect(() => {
    // Gray widgets own their local params, so an auto-claimed default becomes stable.
    // Missing explicit ids resolve to null and are intentionally not rewritten here.
    if (pairColor !== 'gray') return
    if (!entityId) return
    if (!onWidgetParamsChange) return

    const currentEntityId = resolveEntityId(entityIdKey, { params })
    if (currentEntityId === entityId) return

    onWidgetParamsChange({
      ...(params ?? {}),
      [entityIdKey]: entityId,
    })
  }, [entityId, entityIdKey, onWidgetParamsChange, pairColor, params])
}
