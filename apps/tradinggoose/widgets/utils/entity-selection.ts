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
