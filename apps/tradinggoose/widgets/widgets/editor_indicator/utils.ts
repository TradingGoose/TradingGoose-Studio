import { readEntitySelectionState, resolveEntityId } from '@/widgets/utils/entity-selection'

export { readEntitySelectionState }

export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) =>
  resolveEntityId('indicatorId', { params })
