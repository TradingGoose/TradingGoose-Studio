'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { MONITOR_QUERY_POLICY } from '@/lib/logs/query-policy'
import type { WorkflowLog, WorkflowLogOutcome } from '@/lib/logs/types'
import { useLogsList, type LogFilters } from '@/hooks/queries/logs'

const VALID_OUTCOMES = new Set<WorkflowLogOutcome>([
  'running',
  'success',
  'error',
  'skipped',
  'unknown',
])

export type MonitorExecutionSummary = {
  monitorId: string
  lastExecutionLogId: string | null
  lastExecutionAt: string | null
  lastOutcome: WorkflowLogOutcome | null
}

export type UseMonitorExecutionSummariesInput = {
  workspaceId: string
  targetMonitorIds: string[]
  enabled: boolean
}

export type UseMonitorExecutionSummariesResult = {
  summariesByMonitorId: Record<string, MonitorExecutionSummary>
  isLoading: boolean
  isFetching: boolean
  error: string | null
  refresh: () => Promise<unknown>
}

const getMonitorId = (log: WorkflowLog) => {
  const monitorId = (log.executionData as any)?.trigger?.data?.monitor?.id
  return typeof monitorId === 'string' && monitorId.trim() ? monitorId.trim() : null
}

const normalizeOutcome = (log: WorkflowLog): WorkflowLogOutcome | null => {
  if (VALID_OUTCOMES.has(log.outcome)) return log.outcome
  if (log.level === 'error') return 'error'
  return log.level ? 'success' : null
}

const compareLogsNewestFirst = (left: WorkflowLog, right: WorkflowLog) => {
  const startedAtDiff = Date.parse(right.startedAt) - Date.parse(left.startedAt)
  if (startedAtDiff !== 0) return startedAtDiff

  const createdAtDiff = Date.parse(right.recordCreatedAt) - Date.parse(left.recordCreatedAt)
  if (createdAtDiff !== 0) return createdAtDiff

  return right.id.localeCompare(left.id)
}

export const shouldFetchNextMonitorSummaryPage = ({
  loadedLogs,
  summariesByMonitorId,
  targetMonitorIds,
}: {
  loadedLogs: WorkflowLog[]
  summariesByMonitorId: Record<string, MonitorExecutionSummary>
  targetMonitorIds: string[]
}) => {
  if (targetMonitorIds.some((monitorId) => !summariesByMonitorId[monitorId])) {
    return true
  }

  const lastLoadedLog = loadedLogs[loadedLogs.length - 1]
  if (!lastLoadedLog) return false

  return Object.values(summariesByMonitorId).some(
    (summary) => summary.lastExecutionAt === lastLoadedLog.startedAt
  )
}

export function useMonitorExecutionSummaries({
  workspaceId,
  targetMonitorIds,
  enabled,
}: UseMonitorExecutionSummariesInput): UseMonitorExecutionSummariesResult {
  const stableTargetMonitorIds = useMemo(
    () => Array.from(new Set(targetMonitorIds.map((id) => id.trim()).filter(Boolean))).sort(),
    [targetMonitorIds]
  )
  const targetMonitorIdSet = useMemo(
    () => new Set(stableTargetMonitorIds),
    [stableTargetMonitorIds]
  )
  const filters = useMemo<LogFilters>(
    () => ({
      timeRange: 'All time',
      level: 'all',
      workflowIds: [],
      folderIds: [],
      triggers: [],
      searchQuery: '',
      limit: 100,
      details: 'full',
      queryPolicy: MONITOR_QUERY_POLICY,
      queryPolicyKey: 'monitor',
      triggerSource: 'indicator_trigger',
      monitorId: stableTargetMonitorIds.join(','),
    }),
    [stableTargetMonitorIds]
  )

  const logsQuery = useLogsList(workspaceId, filters, {
    enabled: enabled && stableTargetMonitorIds.length > 0,
    refetchInterval: false,
  })

  const summariesByMonitorId = useMemo(() => {
    if (!logsQuery.data) return {}

    const summaries: Record<string, MonitorExecutionSummary> = {}
    const logs = logsQuery.data.pages.flatMap((page) => page.logs).sort(compareLogsNewestFirst)

    for (const log of logs) {
      const monitorId = getMonitorId(log)
      if (!monitorId || !targetMonitorIdSet.has(monitorId) || summaries[monitorId]) {
        continue
      }

      summaries[monitorId] = {
        monitorId,
        lastExecutionLogId: log.id,
        lastExecutionAt: log.startedAt,
        lastOutcome: normalizeOutcome(log),
      }
    }

    return summaries
  }, [logsQuery.data, targetMonitorIdSet])

  useEffect(() => {
    if (!enabled || stableTargetMonitorIds.length === 0) return
    if (!logsQuery.hasNextPage || logsQuery.isFetchingNextPage) return

    const loadedLogs = logsQuery.data?.pages.flatMap((page) => page.logs) ?? []
    if (
      shouldFetchNextMonitorSummaryPage({
        loadedLogs,
        summariesByMonitorId,
        targetMonitorIds: stableTargetMonitorIds,
      })
    ) {
      void logsQuery.fetchNextPage()
    }
  }, [
    enabled,
    logsQuery,
    stableTargetMonitorIds,
    summariesByMonitorId,
  ])

  const refresh = useCallback(() => logsQuery.refetch(), [logsQuery])

  return {
    summariesByMonitorId,
    isLoading:
      enabled &&
      stableTargetMonitorIds.length > 0 &&
      !logsQuery.error &&
      (!logsQuery.data || logsQuery.hasNextPage || logsQuery.isFetchingNextPage),
    isFetching: logsQuery.isFetching,
    error:
      logsQuery.error instanceof Error
        ? logsQuery.error.message
        : logsQuery.error
          ? 'Failed to load monitor execution summaries'
          : null,
    refresh,
  }
}
