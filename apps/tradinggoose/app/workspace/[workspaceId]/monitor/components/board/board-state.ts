import { MONITOR_ASSET_TYPE_LABELS, MONITOR_ASSET_TYPES } from '@/lib/monitors/sources'
import {
  getExecutionAggregate,
  getExecutionGroupValue,
  type MonitorExecutionGroupLabels,
  type MonitorExecutionItem,
  sortExecutionGroups,
} from '../data/execution-ordering'
import type {
  ExecutionMonitorFieldSum,
  ExecutionMonitorGroupField,
  ExecutionMonitorViewConfig,
} from '../view/view-config'

export type MonitorBoardColumn = {
  id: string
  fieldId: string
  label: string
  items: MonitorExecutionItem[]
  totalCount: number
  aggregates: Partial<Record<ExecutionMonitorFieldSum, number>>
  limit: number | null
}

export type MonitorBoardSection = {
  id: string
  label: string
  columns: MonitorBoardColumn[]
}

type MonitorBoardLabels = {
  allExecutionsLabel: string
  emptyColumnValues: Partial<
    Record<ExecutionMonitorGroupField, Array<{ id: string; label: string; sortValue: string }>>
  >
  groupFieldLabels: Record<ExecutionMonitorGroupField, string>
  groupValueLabels: MonitorExecutionGroupLabels
}

const reorderColumnItems = (items: MonitorExecutionItem[], orderedIds: string[]) => {
  if (orderedIds.length === 0) {
    return items
  }

  const orderMap = new Map(orderedIds.map((id, index) => [id, index]))
  return [...items].sort((left, right) => {
    const leftOrder = orderMap.get(left.logId)
    const rightOrder = orderMap.get(right.logId)

    if (typeof leftOrder === 'number' && typeof rightOrder === 'number') {
      return leftOrder - rightOrder
    }
    if (typeof leftOrder === 'number') return -1
    if (typeof rightOrder === 'number') return 1
    return 0
  })
}

const GROUP_FIELD_LABELS: Record<ExecutionMonitorGroupField, string> = {
  outcome: 'Outcome',
  workflow: 'Workflow',
  trigger: 'Trigger',
  listing: 'Listing',
  assetType: 'Asset type',
  provider: 'Provider',
  interval: 'Interval',
  monitor: 'Monitor',
}

const EMPTY_COLUMN_VALUES: Partial<
  Record<ExecutionMonitorGroupField, Array<{ id: string; label: string; sortValue: string }>>
> = {
  outcome: [
    { id: 'running', label: 'Running', sortValue: 'running' },
    { id: 'error', label: 'Error', sortValue: 'error' },
    { id: 'success', label: 'Success', sortValue: 'success' },
    { id: 'skipped', label: 'Skipped', sortValue: 'skipped' },
    { id: 'unknown', label: 'Unknown', sortValue: 'unknown' },
  ],
  trigger: [
    { id: 'api', label: 'API', sortValue: 'api' },
    { id: 'manual', label: 'Manual', sortValue: 'manual' },
    { id: 'webhook', label: 'Webhook', sortValue: 'webhook' },
    { id: 'chat', label: 'Chat', sortValue: 'chat' },
    { id: 'schedule', label: 'Schedule', sortValue: 'schedule' },
    { id: 'unknown', label: 'Unknown', sortValue: 'unknown' },
  ],
  assetType: MONITOR_ASSET_TYPES.map((id) => ({
    id,
    label: MONITOR_ASSET_TYPE_LABELS[id],
    sortValue: id,
  })),
}

const DEFAULT_BOARD_LABELS: MonitorBoardLabels = {
  allExecutionsLabel: 'All executions',
  emptyColumnValues: EMPTY_COLUMN_VALUES,
  groupFieldLabels: GROUP_FIELD_LABELS,
  groupValueLabels: {
    assetTypeLabels: MONITOR_ASSET_TYPE_LABELS,
    outcomeLabels: {
      running: 'Running',
      success: 'Success',
      error: 'Error',
      skipped: 'Skipped',
      unknown: 'Unknown',
    },
    removedMonitorLabel: 'Removed monitor',
    triggerLabels: {
      api: 'API',
      manual: 'Manual',
      webhook: 'Webhook',
      chat: 'Chat',
      schedule: 'Schedule',
      unknown: 'Unknown',
    },
    unknownLabel: 'Unknown',
    unknownListingLabel: 'Unknown listing',
  },
}

const buildEmptyColumns = (
  columnField: ExecutionMonitorGroupField,
  config: ExecutionMonitorViewConfig,
  labels: MonitorBoardLabels
): MonitorBoardColumn[] => {
  const values = labels.emptyColumnValues[columnField] ?? [
    {
      id: columnField,
      label: labels.groupFieldLabels[columnField],
      sortValue: columnField,
    },
  ]

  return values
    .filter((value) => !config.kanban.hiddenColumnIds.includes(value.id))
    .map((value) => ({
      id: value.id,
      fieldId: value.id,
      label: value.label,
      items: [],
      totalCount: 0,
      aggregates: Object.fromEntries(config.fieldSums.map((field) => [field, 0])) as Partial<
        Record<ExecutionMonitorFieldSum, number>
      >,
      limit: config.kanban.columnLimits[value.id] ?? null,
    }))
}

export const buildMonitorBoardSections = (
  items: MonitorExecutionItem[],
  config: ExecutionMonitorViewConfig,
  labels: MonitorBoardLabels = DEFAULT_BOARD_LABELS
): MonitorBoardSection[] => {
  const columnField = config.kanban.columnField
  const sectionField =
    config.verticalGroupBy ??
    config.sliceBy ??
    (config.groupBy === columnField ? null : config.groupBy)

  if (items.length === 0) {
    return [
      {
        id: 'all',
        label: labels.allExecutionsLabel,
        columns: buildEmptyColumns(columnField, config, labels),
      },
    ]
  }

  const sections = new Map<string, MonitorBoardSection>()
  const sectionValues = new Map<string, ReturnType<typeof getExecutionGroupValue>>()
  const columnValues = new Map<string, ReturnType<typeof getExecutionGroupValue>>()

  items.forEach((item) => {
    const sectionValue = sectionField
      ? getExecutionGroupValue(item, sectionField, labels.groupValueLabels)
      : { id: 'all', label: labels.allExecutionsLabel, sortValue: 'all' }
    const columnValue = getExecutionGroupValue(item, columnField, labels.groupValueLabels)

    const section = sections.get(sectionValue.id) ?? {
      id: sectionValue.id,
      label: sectionValue.label,
      columns: [],
    }
    sectionValues.set(sectionValue.id, sectionValue)

    let column = section.columns.find((entry) => entry.fieldId === columnValue.id)
    if (!column) {
      const renderedColumnId =
        sectionValue.id === 'all' ? columnValue.id : `${sectionValue.id}::${columnValue.id}`
      column = {
        id: renderedColumnId,
        fieldId: columnValue.id,
        label: columnValue.label,
        items: [],
        totalCount: 0,
        aggregates: {},
        limit: config.kanban.columnLimits[columnValue.id] ?? null,
      }
      section.columns.push(column)
      columnValues.set(renderedColumnId, columnValue)
    }

    column.items.push(item)
    sections.set(sectionValue.id, section)
  })

  return sortExecutionGroups(
    Array.from(sections.values()),
    sectionField,
    (section) =>
      sectionValues.get(section.id) ?? {
        id: section.id,
        label: section.label,
        sortValue: section.label,
      }
  ).map((section) => ({
    ...section,
    columns: sortExecutionGroups(
      section.columns.filter((column) => !config.kanban.hiddenColumnIds.includes(column.fieldId)),
      columnField,
      (column) =>
        columnValues.get(column.id) ?? {
          id: column.fieldId,
          label: column.label,
          sortValue: column.label,
        }
    ).map((column) => {
      const orderedItems =
        config.sortBy.length === 0
          ? reorderColumnItems(column.items, config.kanban.localCardOrder[column.id] ?? [])
          : column.items

      const aggregates = Object.fromEntries(
        config.fieldSums.map((field) => [field, getExecutionAggregate(orderedItems, field)])
      ) as Partial<Record<ExecutionMonitorFieldSum, number>>
      const limitedItems = column.limit ? orderedItems.slice(0, column.limit) : orderedItems

      return {
        ...column,
        items: limitedItems,
        totalCount: orderedItems.length,
        aggregates,
      }
    }),
  }))
}
