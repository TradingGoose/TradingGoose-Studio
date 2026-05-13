export interface EntitySelectionState {
  selectedEntityId: string | null
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
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  const value = params?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value : null
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
