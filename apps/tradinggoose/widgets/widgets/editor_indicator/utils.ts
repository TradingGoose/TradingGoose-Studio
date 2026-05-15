import { readEntitySelectionState } from '@/widgets/utils/entity-selection'

export { readEntitySelectionState }

export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) => {
  const indicatorId = params?.indicatorId

  return typeof indicatorId === 'string' && indicatorId.trim().length > 0
    ? indicatorId.trim()
    : null
}
