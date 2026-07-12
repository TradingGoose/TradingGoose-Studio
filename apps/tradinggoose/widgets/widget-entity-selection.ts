const normalizeEntitySelectionId = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveEntityId(
  key: string,
  { params }: { params?: Record<string, unknown> | null }
): string | null {
  const value = params?.[key]
  return typeof value === 'string' ? normalizeEntitySelectionId(value) : null
}

export function resolveEntityIdFromList({
  requestedEntityId,
  entityIds,
  useDefaultEntity = true,
}: {
  requestedEntityId?: string | null
  entityIds: readonly string[]
  useDefaultEntity?: boolean
}): string | null {
  const requested = normalizeEntitySelectionId(requestedEntityId)
  if (requested) return entityIds.includes(requested) ? requested : null
  return useDefaultEntity ? (entityIds[0] ?? null) : null
}
