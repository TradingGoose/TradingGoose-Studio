export const getIndicatorIdFromParams = (
  params?: Record<string, unknown> | null
): string | null => {
  if (!params || typeof params !== 'object') return null
  const value = params.indicatorId
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
