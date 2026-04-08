export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) => {
  return typeof params?.indicatorId === 'string' && params.indicatorId.trim().length > 0
    ? params.indicatorId.trim()
    : null
}
