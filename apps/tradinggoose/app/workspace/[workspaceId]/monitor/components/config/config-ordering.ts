import type {
  ConfigMonitorSortField,
  ConfigMonitorSortRule,
} from '../view/view-config'
import type { ConfigMonitorCard } from './config-card-model'

const compareStrings = (left: string, right: string) =>
  left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' })

const compareNullableStrings = (
  left: string | null,
  right: string | null,
  direction: 'asc' | 'desc'
) => {
  const leftMissing = left === null || left === ''
  const rightMissing = right === null || right === ''

  if (leftMissing && rightMissing) return 0
  if (leftMissing) return 1
  if (rightMissing) return -1

  const comparison = compareStrings(left, right)
  return direction === 'asc' ? comparison : -comparison
}

const getStringSortValue = (card: ConfigMonitorCard, field: ConfigMonitorSortField) => {
  switch (field) {
    case 'workflowTargetLabel':
      return card.workflowTargetLabel
    case 'indicatorName':
      return card.indicatorName
    case 'listingLabel':
      return card.listingLabel
    case 'providerId':
      return card.providerId
    case 'interval':
      return card.interval
    case 'status':
      return card.status
    case 'createdAt':
      return card.createdAt
    case 'updatedAt':
      return card.updatedAt
    case 'lastExecutionAt':
      return card.lastExecutionAt
    case 'lastOutcome':
      return card.lastOutcome
  }
}

const compareCardsByField = (
  left: ConfigMonitorCard,
  right: ConfigMonitorCard,
  rule: ConfigMonitorSortRule
) => {
  if (rule.field === 'lastExecutionAt' || rule.field === 'lastOutcome') {
    return compareNullableStrings(
      getStringSortValue(left, rule.field),
      getStringSortValue(right, rule.field),
      rule.direction
    )
  }

  const comparison = compareStrings(
    getStringSortValue(left, rule.field) ?? '',
    getStringSortValue(right, rule.field) ?? ''
  )
  return rule.direction === 'asc' ? comparison : -comparison
}

const applyLocalOrder = (cards: ConfigMonitorCard[], orderedIds: string[]) => {
  if (orderedIds.length === 0) return cards

  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  return [...cards].sort((left, right) => {
    const leftOrder = orderMap.get(left.monitorId)
    const rightOrder = orderMap.get(right.monitorId)

    if (typeof leftOrder === 'number' && typeof rightOrder === 'number') {
      return leftOrder - rightOrder
    }
    if (typeof leftOrder === 'number') return -1
    if (typeof rightOrder === 'number') return 1
    return compareStrings(left.monitorId, right.monitorId)
  })
}

export const sortConfigMonitorCards = (
  cards: ConfigMonitorCard[],
  sortBy: ConfigMonitorSortRule[],
  localOrder: string[] = []
) => {
  if (sortBy.length === 0) {
    return applyLocalOrder(cards, localOrder)
  }

  return [...cards].sort((left, right) => {
    for (const rule of sortBy) {
      const comparison = compareCardsByField(left, right, rule)
      if (comparison !== 0) return comparison
    }
    return compareStrings(left.monitorId, right.monitorId)
  })
}

export const sortConfigAxisValues = <T extends { sortValue: string; label: string; id: string }>(
  values: T[]
) =>
  [...values].sort((left, right) => {
    const sortComparison = compareStrings(left.sortValue, right.sortValue)
    if (sortComparison !== 0) return sortComparison

    const labelComparison = compareStrings(left.label, right.label)
    if (labelComparison !== 0) return labelComparison

    return compareStrings(left.id, right.id)
  })
