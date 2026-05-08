import { useEffect, useMemo } from 'react'
import { type ListingInputValue, toListingValueObject } from '@/lib/listing/identity'
import { createSearchClause, serializeQuery } from '@/lib/logs/query-parser'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import type { SearchClause } from '@/lib/logs/query-types'
import { useLogsList } from '@/hooks/queries/logs'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import { buildMonitorBoardSections } from '../board/board-state'
import type { IndicatorMonitorRecord } from '../shared/types'
import { buildMonitorTimelineGroups } from '../timeline/timeline-state'
import type {
  ExecutionMonitorQuickFilter,
  ExecutionMonitorQuickFilterField,
  ExecutionMonitorViewConfig,
} from '../view/view-config'
import {
  type MonitorExecutionItem,
  type MonitorExecutionOutcome,
  sortExecutionItems,
} from './execution-ordering'

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
const MONITOR_EXECUTION_AUTO_PAGE_LIMIT = 3

type MonitorQuickFilterClause = {
  id: string
  raw: string
  field: ExecutionMonitorQuickFilterField
  operator: ExecutionMonitorQuickFilter['operator']
  values: string[]
}
type MonitorExecutionSnapshot = {
  id?: unknown
  providerId?: unknown
  interval?: unknown
  indicatorId?: unknown
  listing?: unknown
}
type MonitorWorkflowLog = WorkflowLog & {
  startedAt?: string
  endedAt?: string | null
  durationMs?: number | null
  outcome?: MonitorExecutionOutcome
  executionData?: WorkflowLog['executionData'] & {
    totalDuration?: number | null
    trigger?: {
      data?: {
        monitor?: MonitorExecutionSnapshot
      }
    }
  }
}

const getListingLabel = (listing: unknown) => {
  const normalized = toListingValueObject(listing as ListingInputValue)
  if (!normalized) return 'Unknown listing'

  if (normalized.listing_type === 'default') {
    return normalized.listing_id || 'Unknown listing'
  }

  return [normalized.base_id, normalized.quote_id].filter(Boolean).join('/') || 'Unknown listing'
}

const parseDurationMs = (duration: string | null | undefined) => {
  if (!duration) return null
  const match = /^(\d+(?:\.\d+)?)ms$/.exec(duration.trim())
  return match ? Number(match[1]) : null
}

const getDurationMs = (log: MonitorWorkflowLog) =>
  log.durationMs ??
  (typeof log.executionData?.totalDuration === 'number' ? log.executionData.totalDuration : null) ??
  parseDurationMs(log.duration)

const getEndedAt = (
  startedAt: string,
  endedAt: string | null | undefined,
  durationMs: number | null
) => {
  if (endedAt) return endedAt
  if (durationMs === null) return null

  const startedAtMs = new Date(startedAt).getTime()
  return Number.isFinite(startedAtMs) ? new Date(startedAtMs + durationMs).toISOString() : null
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
  const values = filter.values.map((value) => value.trim()).filter(Boolean)
  const clause = toMonitorQuickFilterSearchClause({ ...filter, values })

  return {
    id: clause.raw,
    raw: clause.raw,
    field: filter.field,
    operator: filter.operator,
    values,
  }
}

const toMonitorQuickFilterSearchClause = (filter: ExecutionMonitorQuickFilter): SearchClause => {
  const field = QUICK_FILTER_FIELD_TO_QUERY_FIELD[filter.field]
  const fieldPolicy = MONITOR_QUERY_POLICY.fields[field]
  const kind: SearchClause['kind'] =
    filter.operator === 'has' || filter.operator === 'no' ? filter.operator : 'field'

  if (!fieldPolicy || !fieldPolicy.clauseKinds.includes(kind)) {
    throw new Error(`Unsupported monitor quick filter: ${filter.field}`)
  }

  return createSearchClause(
    {
      kind,
      field,
      negated: filter.operator === 'exclude',
      operator: '=',
      valueMode: filter.field === 'workflow' ? 'id' : fieldPolicy.valueKind,
      values: kind === 'field' ? filter.values : [],
    },
    MONITOR_QUERY_POLICY
  )
}

const toMonitorQuickFilterSearchClauses = (quickFilters: ExecutionMonitorQuickFilter[]) =>
  quickFilters.map(toMonitorQuickFilterSearchClause)

const buildMonitorExecutionSearchQuery = (viewConfig: ExecutionMonitorViewConfig) =>
  serializeQuery(
    {
      clauses: toMonitorQuickFilterSearchClauses(viewConfig.quickFilters),
      textSearch: viewConfig.filterQuery.trim(),
    },
    MONITOR_QUERY_POLICY
  )

export const buildMonitorExecutionLogFilters = (viewConfig: ExecutionMonitorViewConfig) => ({
  timeRange: 'All time',
  level: 'all',
  workflowIds: [],
  folderIds: [],
  triggers: [],
  searchQuery: buildMonitorExecutionSearchQuery(viewConfig),
  queryPolicy: MONITOR_QUERY_POLICY,
  queryPolicyKey: 'monitor' as const,
  limit: 100,
  details: 'full' as const,
  triggerSource: 'indicator_trigger' as const,
})

const toExecutionItem = (
  log: MonitorWorkflowLog,
  liveMonitorIds: Set<string>
): MonitorExecutionItem => {
  const snapshot = log.executionData?.trigger?.data?.monitor ?? null
  const startedAt = log.startedAt ?? log.createdAt
  const durationMs = getDurationMs(log)
  const endedAt = getEndedAt(startedAt, log.endedAt, durationMs)
  const rawListing = snapshot?.listing ?? null
  const listing = toListingValueObject(rawListing as ListingInputValue)
  const monitorId = typeof snapshot?.id === 'string' ? snapshot.id : null
  const providerId = typeof snapshot?.providerId === 'string' ? snapshot.providerId : null
  const interval = typeof snapshot?.interval === 'string' ? snapshot.interval : null
  const indicatorId = typeof snapshot?.indicatorId === 'string' ? snapshot.indicatorId : null
  const listingWithAssetClass = rawListing as {
    assetClass?: string
    base_asset_class?: string
    listing_type?: string
  } | null
  const assetType =
    (typeof listingWithAssetClass?.assetClass === 'string' &&
      listingWithAssetClass.assetClass.trim()) ||
    (typeof listingWithAssetClass?.base_asset_class === 'string' &&
      listingWithAssetClass.base_asset_class.trim()) ||
    (typeof listingWithAssetClass?.listing_type === 'string' &&
      listingWithAssetClass.listing_type.trim()) ||
    'unknown'

  return {
    logId: log.id,
    workflowId: log.workflowId ?? 'unknown',
    executionId: log.executionId ?? null,
    startedAt,
    endedAt,
    durationMs,
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

  const logsQuery = useLogsList(workspaceId, filters, {
    enabled: Boolean(workspaceId),
    refetchInterval: false,
  })
  const loadedPageCount = logsQuery.data?.pages.length ?? 0
  const reachedAutoPageLimit = loadedPageCount >= MONITOR_EXECUTION_AUTO_PAGE_LIMIT

  useEffect(() => {
    if (
      loadedPageCount === 0 ||
      reachedAutoPageLimit ||
      !logsQuery.hasNextPage ||
      logsQuery.isFetchingNextPage
    ) {
      return
    }

    void logsQuery.fetchNextPage()
  }, [
    loadedPageCount,
    logsQuery.fetchNextPage,
    logsQuery.hasNextPage,
    logsQuery.isFetchingNextPage,
    reachedAutoPageLimit,
  ])

  const liveMonitorIds = useMemo(
    () => new Set(monitors.map((monitor) => monitor.monitorId)),
    [monitors]
  )

  const executionItems = useMemo(() => {
    const logs = logsQuery.data?.pages.flatMap((page) => page.logs) ?? []
    const items = logs.map((log) => toExecutionItem(log, liveMonitorIds))

    return sortExecutionItems(items, viewConfig.sortBy)
  }, [liveMonitorIds, logsQuery.data?.pages, viewConfig.sortBy])

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
      (!logsQuery.data ||
        (logsQuery.hasNextPage && !reachedAutoPageLimit) ||
        logsQuery.isFetchingNextPage),
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
