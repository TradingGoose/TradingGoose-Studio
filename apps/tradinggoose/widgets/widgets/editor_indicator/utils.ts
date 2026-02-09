export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) => {
  if (!params || typeof params !== 'object') return null
  const value = (params as Record<string, unknown>).pineIndicatorId
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

