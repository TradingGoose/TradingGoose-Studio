import type { ListingIdentity } from '@/lib/listing/identity'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import type {
  MonitorFieldSum,
  MonitorGroupField,
  MonitorSortField,
  MonitorSortRule,
} from '../view/view-config'

export type MonitorExecutionItem = {
  logId: string
  workflowId: string
  executionId: string | null
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  outcome: WorkflowLog['outcome']
  trigger: string | null
  workflowName: string
  workflowColor: string
  monitorId: string | null
  providerId: string | null
  interval: string | null
  indicatorId: string | null
  assetType: string
  listing: ListingIdentity | null
  listingLabel: string
  cost: number | null
  isOrphaned: boolean
  isPartial: boolean
  sourceLog: WorkflowLog
}

export type ExecutionGroupValue = {
  id: string
  label: string
  sortValue: string
}

const OUTCOME_ORDER: Record<MonitorExecutionItem['outcome'], number> = {
  running: 0,
  error: 1,
  success: 2,
  skipped: 3,
  unknown: 4,
}

const normalize = (value: string | null | undefined) => value?.trim() || ''

const compareStrings = (left: string, right: string) =>
  left.localeCompare(right, 'en-US', { numeric: true, sensitivity: 'base' })

const compareNumbers = (left: number | null, right: number | null) => {
  const safeLeft = left ?? Number.NEGATIVE_INFINITY
  const safeRight = right ?? Number.NEGATIVE_INFINITY
  return safeLeft - safeRight
}

export const getExecutionGroupValue = (
  item: MonitorExecutionItem,
  field: MonitorGroupField
): ExecutionGroupValue => {
  switch (field) {
    case 'outcome':
      return {
        id: item.outcome,
        label: item.outcome.charAt(0).toUpperCase() + item.outcome.slice(1),
        sortValue: item.outcome,
      }
    case 'workflow':
      return {
        id: item.workflowId,
        label: item.workflowName,
        sortValue: item.workflowName,
      }
    case 'trigger':
      return {
        id: item.trigger || 'unknown',
        label: item.trigger || 'Unknown',
        sortValue: item.trigger || 'unknown',
      }
    case 'listing':
      return {
        id: item.listingLabel || 'unknown',
        label: item.listingLabel || 'Unknown listing',
        sortValue: item.listingLabel || 'unknown',
      }
    case 'assetType':
      return {
        id: item.assetType,
        label: item.assetType.toUpperCase(),
        sortValue: item.assetType,
      }
    case 'provider':
      return {
        id: item.providerId || 'unknown',
        label: item.providerId || 'Unknown',
        sortValue: item.providerId || 'unknown',
      }
    case 'interval':
      return {
        id: item.interval || 'unknown',
        label: item.interval || 'Unknown',
        sortValue: item.interval || 'unknown',
      }
    case 'monitor':
      return {
        id: item.monitorId || 'orphaned',
        label: item.monitorId || 'Removed monitor',
        sortValue: item.monitorId || 'orphaned',
      }
  }
}

export const compareExecutionGroupValues = (
  left: ExecutionGroupValue,
  right: ExecutionGroupValue,
  field: MonitorGroupField
) => {
  if (field === 'outcome') {
    const outcomeComparison =
      (OUTCOME_ORDER[left.id as MonitorExecutionItem['outcome']] ?? Number.MAX_SAFE_INTEGER) -
      (OUTCOME_ORDER[right.id as MonitorExecutionItem['outcome']] ?? Number.MAX_SAFE_INTEGER)

    if (outcomeComparison !== 0) {
      return outcomeComparison
    }
  }

  const sortComparison = compareStrings(left.sortValue, right.sortValue)
  if (sortComparison !== 0) {
    return sortComparison
  }

  const labelComparison = compareStrings(left.label, right.label)
  if (labelComparison !== 0) {
    return labelComparison
  }

  return compareStrings(left.id, right.id)
}

export const sortExecutionGroups = <T>(
  groups: T[],
  field: MonitorGroupField | null,
  getValue: (group: T) => ExecutionGroupValue
) => {
  if (!field) {
    return [...groups]
  }

  return [...groups].sort((left, right) =>
    compareExecutionGroupValues(getValue(left), getValue(right), field)
  )
}

export const compareExecutionItemsByField = (
  left: MonitorExecutionItem,
  right: MonitorExecutionItem,
  field: MonitorSortField
) => {
  switch (field) {
    case 'startedAt':
      return compareStrings(left.startedAt, right.startedAt)
    case 'endedAt':
      return compareStrings(left.endedAt || '', right.endedAt || '')
    case 'durationMs':
      return compareNumbers(left.durationMs, right.durationMs)
    case 'cost':
      return compareNumbers(left.cost, right.cost)
    case 'workflowName':
      return compareStrings(left.workflowName, right.workflowName)
    case 'providerId':
      return compareStrings(normalize(left.providerId), normalize(right.providerId))
    case 'interval':
      return compareStrings(normalize(left.interval), normalize(right.interval))
    case 'listingLabel':
      return compareStrings(left.listingLabel, right.listingLabel)
  }
}

export const sortExecutionItems = (
  items: MonitorExecutionItem[],
  sortBy: MonitorSortRule[]
) => {
  if (sortBy.length === 0) {
    return [...items]
  }

  const appliedSorts: MonitorSortRule[] = sortBy

  return [...items].sort((left, right) => {
    for (const rule of appliedSorts) {
      const comparison = compareExecutionItemsByField(left, right, rule.field)
      if (comparison !== 0) {
        return rule.direction === 'asc' ? comparison : -comparison
      }
    }

    return compareStrings(left.logId, right.logId)
  })
}

export const getExecutionAggregate = (
  items: MonitorExecutionItem[],
  field: MonitorFieldSum
) => {
  switch (field) {
    case 'count':
      return items.length
    case 'durationMs':
      return items.reduce((sum, item) => sum + (item.durationMs ?? 0), 0)
    case 'cost':
      return items.reduce((sum, item) => sum + (item.cost ?? 0), 0)
  }
}
