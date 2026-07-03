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
  if (requested && entityIds.includes(requested)) return requested
  if (requested && !useDefaultEntity) return null

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
