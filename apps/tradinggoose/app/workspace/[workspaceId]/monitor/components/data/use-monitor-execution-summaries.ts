'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useLogsList } from '@/hooks/queries/logs'
import type { WorkflowLog } from '@/stores/logs/filters/types'
import type { MonitorExecutionOutcome } from './execution-ordering'

type MonitorWorkflowLog = WorkflowLog & {
  startedAt?: string
  recordCreatedAt?: string
  outcome?: MonitorExecutionOutcome
  executionData?: WorkflowLog['executionData'] & {
    trigger?: {
      data?: {
        monitor?: {
          id?: unknown
        }
      }
    }
  }
}

const VALID_OUTCOMES = new Set<MonitorExecutionOutcome>([
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
  lastOutcome: MonitorExecutionOutcome | null
}

type UseMonitorExecutionSummariesInput = {
  workspaceId: string
  targetMonitorIds: string[]
  enabled: boolean
}

type UseMonitorExecutionSummariesResult = {
  summariesByMonitorId: Record<string, MonitorExecutionSummary>
  isLoading: boolean
  isFetching: boolean
  error: string | null
  refresh: () => Promise<unknown>
}

const getMonitorId = (log: MonitorWorkflowLog) => {
  const monitorId = (log.executionData as any)?.trigger?.data?.monitor?.id
  return typeof monitorId === 'string' && monitorId.trim() ? monitorId.trim() : null
}

const normalizeOutcome = (log: MonitorWorkflowLog): MonitorExecutionOutcome | null => {
  if (log.outcome && VALID_OUTCOMES.has(log.outcome)) return log.outcome
  if (log.level === 'error') return 'error'
  return log.level ? 'success' : null
}

const getLogStartedAt = (log: MonitorWorkflowLog) => log.startedAt ?? log.createdAt
const getLogRecordCreatedAt = (log: MonitorWorkflowLog) => log.recordCreatedAt ?? log.createdAt

const compareLogsNewestFirst = (left: MonitorWorkflowLog, right: MonitorWorkflowLog) => {
  const startedAtDiff = Date.parse(getLogStartedAt(right)) - Date.parse(getLogStartedAt(left))
  if (startedAtDiff !== 0) return startedAtDiff

  const createdAtDiff =
    Date.parse(getLogRecordCreatedAt(right)) - Date.parse(getLogRecordCreatedAt(left))
  if (createdAtDiff !== 0) return createdAtDiff

  return right.id.localeCompare(left.id)
}

export const shouldFetchNextMonitorSummaryPage = ({
  loadedLogs,
  summariesByMonitorId,
  targetMonitorIds,
}: {
  loadedLogs: MonitorWorkflowLog[]
  summariesByMonitorId: Record<string, MonitorExecutionSummary>
  targetMonitorIds: string[]
}) => {
  if (targetMonitorIds.some((monitorId) => !summariesByMonitorId[monitorId])) {
    return true
  }

  const lastLoadedLog = loadedLogs[loadedLogs.length - 1]
  if (!lastLoadedLog) return false

  return Object.values(summariesByMonitorId).some(
    (summary) => summary.lastExecutionAt === getLogStartedAt(lastLoadedLog)
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
  const filters = useMemo(
    () => ({
      timeRange: 'All time',
      level: 'all',
      workflowIds: [],
      folderIds: [],
      triggers: [],
      searchQuery: '',
      limit: 100,
      details: 'full' as const,
      triggerSource: 'indicator_trigger' as const,
    }),
    []
  )

  const logsQuery = useLogsList(workspaceId, filters, {
    enabled: enabled && stableTargetMonitorIds.length > 0,
    refetchInterval: false,
  })

  const summariesByMonitorId = useMemo(() => {
    if (!logsQuery.data) return {}

    const summaries: Record<string, MonitorExecutionSummary> = {}
    const logs = logsQuery.data.pages
      .flatMap((page) => page.logs as MonitorWorkflowLog[])
      .sort(compareLogsNewestFirst)

    for (const log of logs) {
      const monitorId = getMonitorId(log)
      if (!monitorId || !targetMonitorIdSet.has(monitorId) || summaries[monitorId]) {
        continue
      }

      summaries[monitorId] = {
        monitorId,
        lastExecutionLogId: log.id,
        lastExecutionAt: getLogStartedAt(log),
        lastOutcome: normalizeOutcome(log),
      }
    }

    return summaries
  }, [logsQuery.data, targetMonitorIdSet])

  useEffect(() => {
    if (!enabled || stableTargetMonitorIds.length === 0) return
    if (!logsQuery.hasNextPage || logsQuery.isFetchingNextPage) return

    const loadedLogs =
      logsQuery.data?.pages.flatMap((page) => page.logs as MonitorWorkflowLog[]) ?? []
    if (
      shouldFetchNextMonitorSummaryPage({
        loadedLogs,
        summariesByMonitorId,
        targetMonitorIds: stableTargetMonitorIds,
      })
    ) {
      void logsQuery.fetchNextPage()
    }
  }, [enabled, logsQuery, stableTargetMonitorIds, summariesByMonitorId])

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
