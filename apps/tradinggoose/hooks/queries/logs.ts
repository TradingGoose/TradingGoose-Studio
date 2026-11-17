import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { ListingIdentity } from '@/lib/listing/identity'
import {
  parseQuery,
  queryToApiParams,
  serializeQueryParamValues,
  splitQueryParamValues,
} from '@/lib/logs/query-parser'
import { LOGS_QUERY_POLICY } from '@/lib/logs/query-policy'
import type { QueryPolicy } from '@/lib/logs/query-types'
import type { LogsResponse, WorkflowLog } from '@/stores/logs/filters/types'

export const logKeys = {
  all: ['logs'] as const,
  lists: () => [...logKeys.all, 'list'] as const,
  list: (workspaceId: string | undefined, filters: Omit<LogFilters, 'page'>) =>
    [...logKeys.lists(), workspaceId ?? '', filters] as const,
  details: () => [...logKeys.all, 'detail'] as const,
  detail: (logId: string | undefined) => [...logKeys.details(), logId ?? ''] as const,
}

export interface LogFilters {
  timeRange: string
  level: string
  workflowIds: string[]
  folderIds: string[]
  triggers: string[]
  searchQuery: string
  limit: number
  details?: 'basic' | 'full'
  queryPolicy?: QueryPolicy
  queryPolicyKey?: 'logs' | 'monitor'
  monitorId?: string
  listings?: ListingIdentity[]
  indicatorId?: string
  providerId?: string
  interval?: string
  triggerSource?: string
}

const resolveLogFilters = (
  filters: LogFilters
): Required<Pick<LogFilters, 'details' | 'queryPolicy' | 'queryPolicyKey'>> & LogFilters => ({
  ...filters,
  details: filters.details ?? 'basic',
  queryPolicy: filters.queryPolicy ?? LOGS_QUERY_POLICY,
  queryPolicyKey: filters.queryPolicyKey ?? 'logs',
})

const getLogFilterQueryKey = (filters: ReturnType<typeof resolveLogFilters>) => ({
  ...filters,
  queryPolicy: undefined,
})

const resolveTimeRangeStartDate = (timeRange: string) => {
  if (timeRange === 'All time') {
    return null
  }

  const now = new Date()

  switch (timeRange) {
    case 'Past 30 minutes':
      return new Date(now.getTime() - 30 * 60 * 1000)
    case 'Past hour':
      return new Date(now.getTime() - 60 * 60 * 1000)
    case 'Past 6 hours':
      return new Date(now.getTime() - 6 * 60 * 60 * 1000)
    case 'Past 12 hours':
      return new Date(now.getTime() - 12 * 60 * 60 * 1000)
    case 'Past 24 hours':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000)
    case 'Past 3 days':
      return new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    case 'Past 7 days':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    case 'Past 14 days':
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    case 'Past 30 days':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    default:
      return new Date(0)
  }
}

const MULTI_VALUE_QUERY_PARAMS = new Set([
  'level',
  'excludeLevel',
  'outcomes',
  'excludeOutcomes',
  'workflowIds',
  'excludeWorkflowIds',
  'folderIds',
  'triggers',
  'excludeTriggers',
  'workflowName',
  'excludeWorkflowName',
  'folderName',
  'excludeFolderName',
  'monitorId',
  'excludeMonitorId',
  'providerId',
  'excludeProviderId',
  'interval',
  'excludeInterval',
  'assetTypes',
  'excludeAssetTypes',
  'hasFields',
  'noFields',
])

const mergeParamValues = (left: string | null, right: string) => {
  const values = new Set<string>()

  splitQueryParamValues(left ?? '').forEach((value) => values.add(value))
  splitQueryParamValues(right).forEach((value) => values.add(value))

  return serializeQueryParamValues(values)
}

const mergeQueryParam = (params: URLSearchParams, key: string, value: string) => {
  if (!MULTI_VALUE_QUERY_PARAMS.has(key) || !params.has(key)) {
    params.set(key, value)
    return
  }

  params.set(key, mergeParamValues(params.get(key), value))
}

export function buildLogsRequestParams(
  workspaceId: string,
  filters: LogFilters,
  options?: {
    page?: number
    includePagination?: boolean
    includeDetails?: boolean
  }
) {
  const resolvedFilters = resolveLogFilters(filters)
  const params = new URLSearchParams()
  const currentPage = options?.page ?? 1
  const includePagination = options?.includePagination ?? true
  const includeDetails = options?.includeDetails ?? true

  params.set('workspaceId', workspaceId)
  if (includePagination) {
    params.set('limit', resolvedFilters.limit.toString())
    params.set('offset', ((currentPage - 1) * resolvedFilters.limit).toString())
  }
  if (includeDetails) {
    params.set('details', resolvedFilters.details)
  }

  if (resolvedFilters.level !== 'all') {
    params.set('level', resolvedFilters.level)
  }

  if (resolvedFilters.triggers.length > 0) {
    params.set('triggers', resolvedFilters.triggers.join(','))
  }

  if (resolvedFilters.workflowIds.length > 0) {
    params.set('workflowIds', resolvedFilters.workflowIds.join(','))
  }

  if (resolvedFilters.folderIds.length > 0) {
    params.set('folderIds', resolvedFilters.folderIds.join(','))
  }

  const startDate = resolveTimeRangeStartDate(resolvedFilters.timeRange)
  if (startDate) {
    params.set('startDate', startDate.toISOString())
  }

  if (resolvedFilters.searchQuery.trim()) {
    const parsedQuery = parseQuery(resolvedFilters.searchQuery.trim(), resolvedFilters.queryPolicy)
    const searchParams = queryToApiParams(parsedQuery, resolvedFilters.queryPolicy)

    for (const [key, value] of Object.entries(searchParams)) {
      mergeQueryParam(params, key, value)
    }
  }

  const listings = resolvedFilters.listings ?? []

  const monitorFilters: Array<[string, string | undefined]> = [
    ['monitorId', resolvedFilters.monitorId],
    ['listings', listings.length > 0 ? JSON.stringify(listings) : undefined],
    ['indicatorId', resolvedFilters.indicatorId],
    ['providerId', resolvedFilters.providerId],
    ['interval', resolvedFilters.interval],
    ['triggerSource', resolvedFilters.triggerSource],
  ]

  monitorFilters.forEach(([key, value]) => {
    if (typeof value !== 'string') return
    const trimmed = value.trim()
    if (trimmed.length === 0) return
    params.set(key, trimmed)
  })

  return params.toString()
}

async function fetchLogsPage(
  workspaceId: string,
  filters: LogFilters,
  page: number
): Promise<{
  logs: WorkflowLog[]
  hasMore: boolean
  nextPage: number | undefined
}> {
  const queryParams = buildLogsRequestParams(workspaceId, filters, { page })
  const response = await fetch(`/api/logs?${queryParams}`)

  if (!response.ok) {
    throw new Error('Failed to fetch logs')
  }

  const apiData: LogsResponse = await response.json()
  const hasMore = apiData.data.length === filters.limit && apiData.page < apiData.totalPages

  return {
    logs: apiData.data || [],
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

async function fetchLogDetail(logId: string): Promise<WorkflowLog> {
  const response = await fetch(`/api/logs/${logId}`)

  if (!response.ok) {
    throw new Error('Failed to fetch log details')
  }

  const { data } = await response.json()
  return data
}

interface UseLogsListOptions {
  enabled?: boolean
  refetchInterval?: number | false
}

export function useLogsList(
  workspaceId: string | undefined,
  filters: LogFilters,
  options?: UseLogsListOptions
) {
  const resolvedFilters = resolveLogFilters(filters)

  return useInfiniteQuery({
    queryKey: logKeys.list(workspaceId, getLogFilterQueryKey(resolvedFilters)),
    queryFn: ({ pageParam }) => fetchLogsPage(workspaceId as string, resolvedFilters, pageParam),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
    staleTime: 0, // Always consider stale for real-time logs
    initialPageParam: 1,
    getNextPageParam: (lastPage) => lastPage.nextPage,
  })
}

export function useLogDetail(logId: string | undefined) {
  return useQuery({
    queryKey: logKeys.detail(logId),
    queryFn: () => fetchLogDetail(logId as string),
    enabled: Boolean(logId),
    staleTime: 30 * 1000, // Details can be slightly stale (30 seconds)
  })
}
