import { useEffect, useMemo } from 'react'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import { createSearchClause, parseQuery, serializeQuery } from '@/lib/logs/query-parser'
import { toListingValueObject } from '@/lib/listing/identity'
import { useLogsList } from '@/hooks/queries/logs'
import { buildMonitorBoardSections } from '../board/board-state'
import type { IndicatorMonitorRecord } from '../shared/types'
import { type MonitorExecutionItem, sortExecutionItems } from './execution-ordering'
import { buildMonitorRoadmapGroups } from '../timeline/roadmap-state'
import type {
  MonitorQuickFilter,
  MonitorQuickFilterField,
  MonitorViewConfig,
} from '../view/view-config'

const QUICK_FILTER_FIELD_TO_QUERY_FIELD: Record<MonitorQuickFilterField, string> = {
  outcome: 'status',
  workflow: 'workflow',
  trigger: 'trigger',
  listing: 'listing',
  assetType: 'assetType',
  provider: 'provider',
  interval: 'interval',
  monitor: 'monitor',
}

type MonitorWorkspaceQueryConfig = Pick<MonitorViewConfig, 'filterQuery' | 'quickFilters'>

const getListingLabel = (listing: any) => {
  const normalized = toListingValueObject(listing)
  if (!normalized) return 'Unknown listing'

  if (normalized.listing_type === 'default') {
    return normalized.listing_id || 'Unknown listing'
  }

  return [normalized.base_id, normalized.quote_id].filter(Boolean).join('/') || 'Unknown listing'
}

export const createMonitorQuickFilterClause = (filter: MonitorQuickFilter) => {
  const field = QUICK_FILTER_FIELD_TO_QUERY_FIELD[filter.field]
  const kind = filter.operator === 'has' ? 'has' : filter.operator === 'no' ? 'no' : 'field'

  return createSearchClause(
    {
      kind,
      field,
      negated: filter.operator === 'exclude',
      operator: '=',
      valueMode:
        filter.field === 'workflow' || filter.field === 'monitor' || filter.field === 'provider'
          ? 'id'
          : filter.field === 'listing'
            ? 'listing'
            : 'token',
      values: filter.values,
    },
    MONITOR_QUERY_POLICY
  )
}

export const buildMonitorWorkspaceSearchQuery = (
  viewConfig: MonitorWorkspaceQueryConfig
) => {
  const filterQuery = parseQuery(viewConfig.filterQuery, MONITOR_QUERY_POLICY)
  const quickFilterClauses = viewConfig.quickFilters.map(createMonitorQuickFilterClause)
  const clauses = new Map<string, ReturnType<typeof createMonitorQuickFilterClause>>()

  ;[...filterQuery.clauses, ...quickFilterClauses].forEach((clause) => {
    clauses.set(clause.raw, clause)
  })

  return serializeQuery(
    {
      clauses: Array.from(clauses.values()),
      textSearch: filterQuery.textSearch,
    },
    MONITOR_QUERY_POLICY
  )
}

const toExecutionItem = (
  log: any,
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
    workflowId: log.workflowId,
    executionId: log.executionId,
    startedAt: log.startedAt,
    endedAt: log.endedAt,
    durationMs: log.durationMs,
    outcome: log.outcome,
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
  viewConfig: MonitorViewConfig
  monitors: IndicatorMonitorRecord[]
}) {
  const mergedQuery = useMemo(() => buildMonitorWorkspaceSearchQuery(viewConfig), [viewConfig])

  const logsQuery = useLogsList(
    workspaceId,
    {
      timeRange: 'All time',
      level: 'all',
      workflowIds: [],
      folderIds: [],
      triggers: [],
      searchQuery: mergedQuery,
      limit: 100,
      details: 'full',
      queryPolicy: MONITOR_QUERY_POLICY,
      queryPolicyKey: 'monitor',
      triggerSource: 'indicator_trigger',
    },
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
    return sortExecutionItems(
      logs.map((log) => toExecutionItem(log, liveMonitorIds)),
      viewConfig.sortBy
    )
  }, [liveMonitorIds, logsQuery.data?.pages, viewConfig.sortBy])

  const orderedVisibleLogIds = useMemo(
    () =>
      viewConfig.layout === 'kanban'
        ? buildMonitorBoardSections(executionItems, viewConfig).flatMap((section) =>
            section.columns.flatMap((column) => column.items.map((item) => item.logId))
          )
        : buildMonitorRoadmapGroups(executionItems, viewConfig).flatMap((group) =>
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
