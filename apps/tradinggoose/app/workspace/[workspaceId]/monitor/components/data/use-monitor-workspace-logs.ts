import { useEffect, useMemo } from 'react'
import { toListingValueObject } from '@/lib/listing/identity'
import { useLogsList } from '@/hooks/queries/logs'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { buildMonitorBoardSections } from '../board/board-state'
import type { IndicatorMonitorRecord } from '../shared/types'
import {
  type MonitorExecutionItem,
  type MonitorExecutionOutcome,
  sortExecutionItems,
} from './execution-ordering'
import { buildMonitorTimelineGroups } from '../timeline/timeline-state'
import type {
  ExecutionMonitorQuickFilter,
  ExecutionMonitorQuickFilterField,
  ExecutionMonitorViewConfig,
} from '../view/view-config'

const QUICK_FILTER_FIELD_TO_QUERY_FIELD: Record<ExecutionMonitorQuickFilterField, string> = {
  outcome: 'status',
  workflow: 'workflow',
  trigger: 'trigger',
  listing: 'listing',
  assetType: 'assetType',
  provider: 'provider',
  interval: 'interval',
  monitor: 'monitor',
}

type MonitorWorkspaceQueryConfig = Pick<ExecutionMonitorViewConfig, 'filterQuery' | 'quickFilters'>
type MonitorQuickFilterClause = {
  id: string
  raw: string
  field: ExecutionMonitorQuickFilterField
  operator: ExecutionMonitorQuickFilter['operator']
  values: string[]
}
type MonitorWorkflowLog = WorkflowLog & {
  startedAt?: string
  endedAt?: string | null
  durationMs?: number | null
  outcome?: MonitorExecutionOutcome
  executionData?: WorkflowLog['executionData'] & {
    trigger?: {
      data?: {
        monitor?: any
      }
    }
  }
}

const getListingLabel = (listing: any) => {
  const normalized = toListingValueObject(listing)
  if (!normalized) return 'Unknown listing'

  if (normalized.listing_type === 'default') {
    return normalized.listing_id || 'Unknown listing'
  }

  return [normalized.base_id, normalized.quote_id].filter(Boolean).join('/') || 'Unknown listing'
}

const normalizeFilterValue = (value: string | null | undefined) => value?.trim().toLowerCase() ?? ''

const serializeQuickFilterValue = (
  field: ExecutionMonitorQuickFilterField,
  value: string
) => {
  const trimmed = value.trim()
  const prefix =
    field === 'workflow' || field === 'monitor' || field === 'provider' ? '#' : ''
  const rawValue = `${prefix}${trimmed}`
  return /\s/.test(rawValue) ? JSON.stringify(rawValue) : rawValue
}

const parseDurationMs = (duration: string | null | undefined) => {
  if (!duration) return null
  const match = /^(\d+(?:\.\d+)?)ms$/.exec(duration.trim())
  return match ? Number(match[1]) : null
}

const normalizeOutcome = (log: MonitorWorkflowLog): MonitorExecutionOutcome => {
  if (
    log.outcome === 'running' ||
    log.outcome === 'success' ||
    log.outcome === 'error' ||
    log.outcome === 'skipped' ||
    log.outcome === 'unknown'
  ) {
    return log.outcome
  }

  return log.level === 'error' ? 'error' : log.level ? 'success' : 'unknown'
}

export const createMonitorQuickFilterClause = (
  filter: ExecutionMonitorQuickFilter
): MonitorQuickFilterClause => {
  const field = QUICK_FILTER_FIELD_TO_QUERY_FIELD[filter.field]
  const values = filter.values.map((value) => value.trim()).filter(Boolean)
  const serializedValues = values.map((value) => serializeQuickFilterValue(filter.field, value))
  const raw =
    filter.operator === 'has' || filter.operator === 'no'
      ? `${filter.operator}:${field}`
      : `${filter.operator === 'exclude' ? '-' : ''}${field}:${serializedValues.join('|')}`

  return {
    id: raw,
    raw,
    field: filter.field,
    operator: filter.operator,
    values,
  }
}

export const buildMonitorWorkspaceSearchQuery = (
  viewConfig: MonitorWorkspaceQueryConfig
): string => viewConfig.filterQuery.trim()

export const buildMonitorExecutionLogFilters = (viewConfig: ExecutionMonitorViewConfig) => ({
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: buildMonitorWorkspaceSearchQuery(viewConfig),
  limit: 100,
  details: 'full' as const,
  triggerSource: 'indicator_trigger' as const,
})

const getQuickFilterValues = (
  item: MonitorExecutionItem,
  field: ExecutionMonitorQuickFilterField
) => {
  switch (field) {
    case 'outcome':
      return [item.outcome]
    case 'workflow':
      return [item.workflowId, item.workflowName]
    case 'trigger':
      return item.trigger ? [item.trigger] : []
    case 'listing':
      return item.listingLabel ? [item.listingLabel] : []
    case 'assetType':
      return item.assetType ? [item.assetType] : []
    case 'provider':
      return item.providerId ? [item.providerId] : []
    case 'interval':
      return item.interval ? [item.interval] : []
    case 'monitor':
      return item.monitorId ? [item.monitorId] : []
  }
}

const matchesQuickFilter = (
  item: MonitorExecutionItem,
  filter: ExecutionMonitorQuickFilter
) => {
  const itemValues = getQuickFilterValues(item, filter.field).map(normalizeFilterValue).filter(Boolean)
  const filterValues = filter.values.map(normalizeFilterValue).filter(Boolean)

  if (filter.operator === 'has') {
    return itemValues.length > 0
  }
  if (filter.operator === 'no') {
    return itemValues.length === 0
  }
  if (filterValues.length === 0) {
    return true
  }

  const hasMatch = filterValues.some((value) => itemValues.includes(value))
  return filter.operator === 'exclude' ? !hasMatch : hasMatch
}

const matchesQuickFilters = (
  item: MonitorExecutionItem,
  filters: ExecutionMonitorQuickFilter[]
) => filters.every((filter) => matchesQuickFilter(item, filter))

const toExecutionItem = (
  log: MonitorWorkflowLog,
  liveMonitorIds: Set<string>
): MonitorExecutionItem => {
  const snapshot = log.executionData?.trigger?.data?.monitor ?? null
  const listing = toListingValueObject(snapshot?.listing ?? null)
  const monitorId = typeof snapshot?.id === 'string' ? snapshot.id : null
  const providerId = typeof snapshot?.providerId === 'string' ? snapshot.providerId : null
  const interval = typeof snapshot?.interval === 'string' ? snapshot.interval : null
  const indicatorId = typeof snapshot?.indicatorId === 'string' ? snapshot.indicatorId : null
  const listingWithAssetClass = listing as (typeof listing & {
    assetClass?: string
    base_asset_class?: string
  }) | null
  const assetType =
    (typeof listingWithAssetClass?.assetClass === 'string' && listingWithAssetClass.assetClass.trim()) ||
    (typeof listingWithAssetClass?.base_asset_class === 'string' &&
      listingWithAssetClass.base_asset_class.trim()) ||
    (typeof listing?.listing_type === 'string' && listing.listing_type.trim()) ||
    'unknown'

  return {
    logId: log.id,
    workflowId: log.workflowId ?? 'unknown',
    executionId: log.executionId ?? null,
    startedAt: log.startedAt ?? log.createdAt,
    endedAt: log.endedAt ?? null,
    durationMs: log.durationMs ?? parseDurationMs(log.duration),
    outcome: normalizeOutcome(log),
    trigger: log.trigger,
    workflowName: log.workflow?.name || 'Unknown workflow',
    workflowColor: log.workflow?.color || '#3972F6',
    monitorId,
    providerId,
    interval,
    indicatorId,
    assetType: assetType.toLowerCase(),
    listing,
    listingLabel: getListingLabel(listing),
    cost: typeof log.cost?.total === 'number' ? log.cost.total : null,
    isOrphaned: Boolean(monitorId && !liveMonitorIds.has(monitorId)),
    isPartial: !monitorId || !providerId || !interval || !listing,
    sourceLog: log,
  }
}

export function useMonitorWorkspaceLogs({
  workspaceId,
  viewConfig,
  monitors,
}: {
  workspaceId: string
  viewConfig: ExecutionMonitorViewConfig
  monitors: IndicatorMonitorRecord[]
}) {
  const filters = useMemo(() => buildMonitorExecutionLogFilters(viewConfig), [viewConfig])

  const logsQuery = useLogsList(
    workspaceId,
    filters,
    {
      enabled: Boolean(workspaceId),
      refetchInterval: false,
    }
  )

  useEffect(() => {
    if (!logsQuery.hasNextPage || logsQuery.isFetchingNextPage) {
      return
    }

    void logsQuery.fetchNextPage()
  }, [logsQuery])

  const liveMonitorIds = useMemo(() => new Set(monitors.map((monitor) => monitor.monitorId)), [monitors])

  const executionItems = useMemo(() => {
    const logs = logsQuery.data?.pages.flatMap((page) => page.logs) ?? []
    const filteredItems = logs
      .map((log) => toExecutionItem(log, liveMonitorIds))
      .filter((item) => matchesQuickFilters(item, viewConfig.quickFilters))

    return sortExecutionItems(
      filteredItems,
      viewConfig.sortBy
    )
  }, [liveMonitorIds, logsQuery.data?.pages, viewConfig.quickFilters, viewConfig.sortBy])

  const orderedVisibleLogIds = useMemo(
    () =>
      viewConfig.layout === 'kanban'
        ? buildMonitorBoardSections(executionItems, viewConfig).flatMap((section) =>
            section.columns.flatMap((column) => column.items.map((item) => item.logId))
          )
        : buildMonitorTimelineGroups(executionItems, viewConfig).flatMap((group) =>
            group.items.map((item) => item.id)
          ),
    [executionItems, viewConfig]
  )

  const isSelectionResolved =
    Boolean(logsQuery.data) &&
    !logsQuery.error &&
    !logsQuery.hasNextPage &&
    !logsQuery.isFetchingNextPage

  return {
    executionItems,
    orderedVisibleLogIds,
    isSelectionResolved,
    isLoading:
      !logsQuery.error &&
      (!logsQuery.data || logsQuery.hasNextPage || logsQuery.isFetchingNextPage),
    isFetching: logsQuery.isFetching,
    error:
      logsQuery.error instanceof Error
        ? logsQuery.error.message
        : logsQuery.error
          ? 'Failed to load monitor executions'
          : null,
    refresh: logsQuery.refetch,
  }
}
