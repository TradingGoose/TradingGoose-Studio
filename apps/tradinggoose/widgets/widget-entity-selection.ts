export interface EntitySelectionState {
  selectedEntityId: string | null
}

const normalizeEntitySelectionId = (value: string | null | undefined): string | null => {
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
  const value = pairContext
    ? Object.hasOwn(pairContext, key)
      ? pairContext[key]
      : null
    : params?.[key]
  return typeof value === 'string' ? normalizeEntitySelectionId(value) : null
}

export function resolveEntityIdFromList({
  requestedEntityId,
  currentEntityId,
  entityIds,
  useDefaultEntity = true,
}: {
  requestedEntityId?: string | null
  currentEntityId?: string | null
  entityIds: readonly string[]
  useDefaultEntity?: boolean
}): string | null {
  const requested = normalizeEntitySelectionId(requestedEntityId)
  if (requested) return entityIds.includes(requested) ? requested : null

  const current = normalizeEntitySelectionId(currentEntityId)
  if (current && entityIds.includes(current)) return current

  return useDefaultEntity ? (entityIds[0] ?? null) : null
}

export function readEntitySelectionState(options: {
  params?: Record<string, unknown> | null
  pairContext?: Record<string, unknown> | null
  entityIdKey: string
}): EntitySelectionState {
  return { selectedEntityId: resolveEntityId(options.entityIdKey, options) }
}
