export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) => {
  const indicatorId =
    typeof params?.indicatorId === 'string' ? params.indicatorId : params?.pineIndicatorId

  return typeof indicatorId === 'string' && indicatorId.trim().length > 0
    ? indicatorId.trim()
    : null
}
