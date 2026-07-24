import { resolveEntityId } from '@/widgets/widget-contracts'

export const getIndicatorIdFromParams = (params?: Record<string, unknown> | null) =>
  resolveEntityId('indicatorId', { params })
