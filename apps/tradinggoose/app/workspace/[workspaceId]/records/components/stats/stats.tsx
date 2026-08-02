'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { WorkflowLog } from '@/lib/logs/types'
import { soehne } from '@/app/fonts/soehne/soehne'
import FolderFilter from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/folder'
import Timeline from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/timeline'
import TriggerFilter from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/trigger'
import WorkflowFilter from '@/app/workspace/[workspaceId]/records/components/logs-toolbar/components/filters/components/workflow'
import KPIs from '@/app/workspace/[workspaceId]/records/components/stats/components/kpis'
import WorkflowDetails from '@/app/workspace/[workspaceId]/records/components/stats/components/workflow-details'
import WorkflowsList from '@/app/workspace/[workspaceId]/records/components/stats/components/workflows-list'
import { formatCost } from '@/providers/ai/utils'
import { useFilterStore } from '@/stores/logs/filters/store'

interface WorkflowExecution {
  workflowId: string
  workflowName: string
  segments: {
    successRate: number // 0-100
    timestamp: string
    hasExecutions: boolean
    totalExecutions: number
    successfulExecutions: number
    avgDurationMs?: number
    p50Ms?: number
    p90Ms?: number
    p99Ms?: number
  }[]
  overallSuccessRate: number
}

interface LogsPage {
  offset: number
  hasMore: boolean
  key: string
}

interface LogsResponse {
  data?: WorkflowLog[]
  total?: number
}

const DEFAULT_SEGMENTS = 72
const MIN_SEGMENT_PX = 10
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const TIME_RANGE_MS: Record<string, number> = {
  'Past 30 minutes': HOUR_MS / 2,
  'Past hour': HOUR_MS,
  'Past 6 hours': 6 * HOUR_MS,
  'Past 12 hours': 12 * HOUR_MS,
  'Past 24 hours': DAY_MS,
  'Past 3 days': 3 * DAY_MS,
  'Past 7 days': 7 * DAY_MS,
  'Past 14 days': 14 * DAY_MS,
  'Past 30 days': 30 * DAY_MS,
}
const createRequestOwner = (key: string) => ({
  key,
  query: false,
  workflows: new Set<string>(),
  pages: new Map<string, number>(),
  globalPage: null as number | null,
})
const hasMoreLogs = (offset: number, count: number, total?: number) =>
  typeof total === 'number' ? offset + count < total : count === 50

interface WorkflowDetailsDataLocal {
  errorRates: { timestamp: string; value: number }[]
  durations: { timestamp: string; value: number }[]
  executionCounts: { timestamp: string; value: number }[]
  logs: WorkflowLog[]
  allLogs: WorkflowLog[]
  __meta?: LogsPage
  __loading?: boolean
}

type WorkflowDetailFailure = 'details' | 'more'
type DurationMetric = 'avgDurationMs' | 'p50Ms' | 'p90Ms' | 'p99Ms'

export const resolveWorkflowDetailLifecycle = (
  ids: string[],
  details: Record<string, WorkflowDetailsDataLocal>,
  failures: Partial<Record<string, WorkflowDetailFailure>>,
  key: string
) => {
  const failedIds = ids.filter((id) => failures[id] === 'details')
  return {
    failedIds,
    ready:
      ids.length > 0 &&
      failedIds.length === 0 &&
      ids.every((id) => details[id]?.__meta?.key === key),
  }
}

export const deriveWorkflowDetailsView = (
  details: WorkflowDetailsDataLocal,
  segments: WorkflowExecution['segments'],
  selectedIndices: number[],
  logs: WorkflowLog[]
) => {
  const selected = new Set(selectedIndices)
  const segs = selected.size ? segments.filter((_, index) => selected.has(index)) : segments
  const errorRates = segs.map((segment) => ({
    timestamp: segment.timestamp,
    value:
      segment.totalExecutions > 0
        ? 100 -
          Math.min(
            100,
            Math.max(0, (segment.successfulExecutions / Math.max(1, segment.totalExecutions)) * 100)
          )
        : 0,
  }))
  const executionCounts = segs.map((segment) => ({
    timestamp: segment.timestamp,
    value: segment.totalExecutions || 0,
  }))
  const durationSeries = (metric: DurationMetric) =>
    segs.map((segment) => ({
      timestamp: segment.timestamp,
      value: segment[metric] ?? 0,
    }))
  const durations = durationSeries('avgDurationMs')
  const durationP50 = durationSeries('p50Ms')
  const durationP90 = durationSeries('p90Ms')
  const durationP99 = durationSeries('p99Ms')
  return {
    ...details,
    logs,
    errorRates,
    executionCounts,
    durations,
    durationP50,
    durationP90,
    durationP99,
  }
}

type StatsProps = {
  searchQuery: string
  live: boolean
  refreshRequest: number
  onRefetchingChange: (isRefetching: boolean) => void
}

export function Stats({ searchQuery, live, refreshRequest, onRefetchingChange }: StatsProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const locale = useLocale()
  const t = useTranslations('workspace.logs.dashboard')
  const tWorkflows = useTranslations('workspace.logs.dashboard.workflows')

  const [endTime, setEndTime] = useState<Date>(new Date())
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [loading, setLoading] = useState(true)
  const [isRefetching, setIsRefetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(null)
  const [workflowDetails, setWorkflowDetails] = useState<Record<string, WorkflowDetailsDataLocal>>(
    {}
  )
  const [workflowDetailFailures, setWorkflowDetailFailures] = useState<
    Partial<Record<string, WorkflowDetailFailure>>
  >({})
  const [globalDetails, setGlobalDetails] = useState<WorkflowDetailsDataLocal | null>(null)
  const [globalLogsMeta, setGlobalLogsMeta] = useState<LogsPage>({
    offset: 0,
    hasMore: true,
    key: '',
  })
  const [globalLoadingMore, setGlobalLoadingMore] = useState(false)
  const [aggregateSegments, setAggregateSegments] = useState<
    { timestamp: string; totalExecutions: number; successfulExecutions: number }[]
  >([])
  const [selectedSegments, setSelectedSegments] = useState<Record<string, number[]>>({})
  const [lastAnchorIndices, setLastAnchorIndices] = useState<Record<string, number>>({})
  const [segmentCount, setSegmentCount] = useState<number>(DEFAULT_SEGMENTS)
  const barsAreaRef = useRef<HTMLDivElement | null>(null)
  const lastRefreshRequestRef = useRef(refreshRequest)

  const { workflowIds, folderIds, triggers, timeRange: sidebarTimeRange } = useFilterStore()

  const timeRangeMs = TIME_RANGE_MS[sidebarTimeRange] ?? 30 * DAY_MS
  const requestKey = [
    workspaceId,
    timeRangeMs,
    endTime.toISOString(),
    workflowIds.join(','),
    folderIds.join(','),
    triggers.join(','),
    segmentCount,
    refreshRequest,
  ].join('|')
  const requestOwner = useMemo(() => createRequestOwner(requestKey), [requestKey])
  const requestsRef = useRef(requestOwner)
  useLayoutEffect(() => {
    requestsRef.current = requestOwner
    setWorkflowDetails({})
    setWorkflowDetailFailures({})
  }, [requestOwner])

  const filteredExecutions = searchQuery.trim()
    ? executions.filter((workflow) =>
        workflow.workflowName.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : executions

  const aggregate = useMemo(() => {
    let totalExecutions = 0
    let successfulExecutions = 0
    let activeWorkflows = 0

    for (const wf of executions) {
      let workflowHasExecutions = false
      for (const seg of wf.segments) {
        totalExecutions += seg.totalExecutions || 0
        successfulExecutions += seg.successfulExecutions || 0
        if (seg.hasExecutions) workflowHasExecutions = true
      }
      if (workflowHasExecutions) activeWorkflows += 1
    }

    const failedExecutions = Math.max(totalExecutions - successfulExecutions, 0)
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 100

    return {
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      activeWorkflows,
      successRate,
    }
  }, [executions])

  const getStartTime = useCallback(
    () => new Date(endTime.getTime() - timeRangeMs),
    [endTime, timeRangeMs]
  )

  const fetchExecutions = useCallback(
    async (isInitialLoad = false) => {
      const owner = requestsRef.current
      if (owner.query) return
      owner.query = true
      try {
        if (isInitialLoad) setLoading(true)
        else setIsRefetching(true)
        setError(null)
        setGlobalLoadingMore(false)

        const startTime = getStartTime()
        const params = new URLSearchParams({
          segments: String(segmentCount || DEFAULT_SEGMENTS),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        })

        if (workflowIds.length > 0) params.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) params.set('folderIds', folderIds.join(','))
        if (triggers.length > 0) params.set('triggers', triggers.join(','))

        const response = await fetch(
          `/api/workspaces/${workspaceId}/metrics/executions?${params.toString()}`
        )
        if (requestsRef.current !== owner) return

        if (!response.ok) throw new Error(t('failedToFetchExecutionHistory'))

        const data = await response.json()
        if (requestsRef.current !== owner) return
        const mapped: WorkflowExecution[] = (data.workflows || []).map((wf: any) => {
          const segments = (wf.segments || []).map((s: any) => {
            const total = s.totalExecutions || 0
            const success = s.successfulExecutions || 0
            const hasExecutions = total > 0
            const successRate = hasExecutions ? (success / total) * 100 : 100
            return {
              timestamp: s.timestamp,
              hasExecutions,
              totalExecutions: total,
              successfulExecutions: success,
              successRate,
              avgDurationMs: typeof s.avgDurationMs === 'number' ? s.avgDurationMs : 0,
              p50Ms: typeof s.p50Ms === 'number' ? s.p50Ms : 0,
              p90Ms: typeof s.p90Ms === 'number' ? s.p90Ms : 0,
              p99Ms: typeof s.p99Ms === 'number' ? s.p99Ms : 0,
            }
          })
          const totals = segments.reduce(
            (acc: { total: number; success: number }, seg: (typeof segments)[number]) => {
              acc.total += seg.totalExecutions
              acc.success += seg.successfulExecutions
              return acc
            },
            { total: 0, success: 0 }
          )
          const overallSuccessRate = totals.total > 0 ? (totals.success / totals.total) * 100 : 100
          return {
            workflowId: wf.workflowId,
            workflowName: wf.workflowName,
            segments,
            overallSuccessRate,
          } as WorkflowExecution
        })
        const sortedWorkflows = mapped.sort((a, b) => {
          const errA = a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
          const errB = b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
          return errB - errA
        })
        setExecutions(sortedWorkflows)

        const segmentsCount: number = Number(params.get('segments') || DEFAULT_SEGMENTS)
        const agg: { timestamp: string; totalExecutions: number; successfulExecutions: number }[] =
          Array.from({ length: segmentsCount }, (_, i) => {
            const base = startTime.getTime()
            const ts = new Date(base + Math.floor((i * (endTime.getTime() - base)) / segmentsCount))
            return {
              timestamp: ts.toISOString(),
              totalExecutions: 0,
              successfulExecutions: 0,
            }
          })
        for (const wf of data.workflows as any[]) {
          wf.segments.forEach((s: any, i: number) => {
            const index = Math.min(i, segmentsCount - 1)
            agg[index].totalExecutions += s.totalExecutions || 0
            agg[index].successfulExecutions += s.successfulExecutions || 0
          })
        }
        setAggregateSegments(agg)

        const errorRates = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions > 0 ? (1 - s.successfulExecutions / s.totalExecutions) * 100 : 0,
        }))
        const executionCounts = agg.map((s) => ({
          timestamp: s.timestamp,
          value: s.totalExecutions,
        }))

        const logsParams = new URLSearchParams({
          limit: '50',
          offset: '0',
          workspaceId,
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          order: 'desc',
          details: 'full',
        })
        if (workflowIds.length > 0) logsParams.set('workflowIds', workflowIds.join(','))
        if (folderIds.length > 0) logsParams.set('folderIds', folderIds.join(','))
        if (triggers.length > 0) logsParams.set('triggers', triggers.join(','))

        let logsData: LogsResponse
        try {
          const logsResponse = await fetch(`/api/logs?${logsParams.toString()}`)
          if (requestsRef.current !== owner) return
          if (!logsResponse.ok) throw new Error(t('failedToFetchExecutionHistory'))
          logsData = (await logsResponse.json()) as LogsResponse
        } catch {
          if (requestsRef.current !== owner) return
          setGlobalDetails({
            errorRates,
            durations: [],
            executionCounts,
            logs: [],
            allLogs: [],
          })
          setGlobalLogsMeta({ offset: 0, hasMore: true, key: owner.key })
          setWorkflowDetailFailures((prev) => ({ ...prev, all: 'details' }))
          return
        }
        if (requestsRef.current !== owner) return
        const mappedLogs = Array.isArray(logsData.data) ? logsData.data : []

        setGlobalDetails({
          errorRates,
          durations: [],
          executionCounts,
          logs: mappedLogs,
          allLogs: mappedLogs,
        })
        setGlobalLogsMeta({
          offset: mappedLogs.length,
          hasMore: hasMoreLogs(0, mappedLogs.length, logsData.total),
          key: owner.key,
        })
      } catch (err) {
        if (requestsRef.current !== owner) return
        console.error('Error fetching executions:', err)
        setError(err instanceof Error ? err.message : t('failedToFetchExecutionHistory'))
      } finally {
        owner.query = false
        if (requestsRef.current === owner) {
          setLoading(false)
          setIsRefetching(false)
        }
      }
    },
    [
      workspaceId,
      timeRangeMs,
      endTime,
      getStartTime,
      workflowIds,
      folderIds,
      triggers,
      segmentCount,
      t,
    ]
  )

  const fetchWorkflowDetails = useCallback(
    async (workflowId: string) => {
      if (!workflowId || workflowId === '__multi__') return
      const owner = requestsRef.current
      if (owner.workflows.has(workflowId)) return
      owner.workflows.add(workflowId)
      setWorkflowDetailFailures((prev) =>
        prev[workflowId] ? { ...prev, [workflowId]: undefined } : prev
      )
      try {
        const startTime = getStartTime()
        const response = await fetch(
          `/api/logs?${new URLSearchParams({
            limit: '50',
            offset: '0',
            workspaceId,
            startDate: startTime.toISOString(),
            endDate: endTime.toISOString(),
            order: 'desc',
            details: 'full',
            workflowIds: workflowId,
            ...(folderIds.length > 0 ? { folderIds: folderIds.join(',') } : {}),
            ...(triggers.length > 0 ? { triggers: triggers.join(',') } : {}),
          }).toString()}`
        )
        if (requestsRef.current !== owner) return

        if (!response.ok) throw new Error(t('failedToFetchExecutionHistory'))

        const data = (await response.json()) as LogsResponse
        if (requestsRef.current !== owner) return
        const mappedLogs = Array.isArray(data.data) ? data.data : []

        setWorkflowDetails((prev) => ({
          ...prev,
          [workflowId]: {
            errorRates: [],
            durations: [],
            executionCounts: [],
            logs: mappedLogs,
            allLogs: mappedLogs,
            __meta: {
              offset: mappedLogs.length,
              hasMore: hasMoreLogs(0, mappedLogs.length, data.total),
              key: owner.key,
            },
          },
        }))
      } catch (err) {
        if (requestsRef.current !== owner) return
        console.error('Error fetching workflow details:', err)
        setWorkflowDetailFailures((prev) => ({ ...prev, [workflowId]: 'details' }))
      } finally {
        owner.workflows.delete(workflowId)
      }
    },
    [workspaceId, endTime, getStartTime, folderIds, triggers, t]
  )

  const loadMoreLogs = useCallback(
    async (workflowId: string) => {
      const owner = requestsRef.current
      const details = workflowDetails[workflowId]
      const meta = details?.__meta
      if (!meta?.hasMore || meta.key !== owner.key || owner.pages.get(workflowId) === meta.offset)
        return
      const offset = meta.offset
      owner.pages.set(workflowId, offset)
      let completed = false
      try {
        setWorkflowDetailFailures((prev) =>
          prev[workflowId] ? { ...prev, [workflowId]: undefined } : prev
        )
        setWorkflowDetails((prev) => {
          const cur = prev[workflowId]
          if (cur?.__meta?.key !== owner.key) return prev
          return {
            ...prev,
            [workflowId]: { ...cur, __loading: true },
          }
        })
        const startTime = getStartTime()
        const qp = new URLSearchParams({
          limit: '50',
          offset: String(offset),
          workspaceId,
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          order: 'desc',
          details: 'full',
          workflowIds: workflowId,
        })
        if (folderIds.length > 0) qp.set('folderIds', folderIds.join(','))
        if (triggers.length > 0) qp.set('triggers', triggers.join(','))
        const res = await fetch(`/api/logs?${qp.toString()}`)
        if (requestsRef.current !== owner) return
        if (!res.ok) throw new Error('Workflow log pagination failed')
        const data = (await res.json()) as LogsResponse
        if (requestsRef.current !== owner) return
        const more = Array.isArray(data.data) ? data.data : []

        setWorkflowDetails((prev) => {
          const cur = prev[workflowId]
          if (cur?.__meta?.key !== owner.key || cur.__meta.offset !== offset) return prev
          const seen = new Set<string>()
          const dedup = [...cur.allLogs, ...more].filter((x) => {
            const id = x.id
            if (seen.has(id)) return false
            seen.add(id)
            return true
          })
          return {
            ...prev,
            [workflowId]: {
              ...cur,
              logs: dedup,
              allLogs: dedup,
              __meta: {
                offset: offset + more.length,
                hasMore: hasMoreLogs(offset, more.length, data.total),
                key: owner.key,
              },
            },
          }
        })
        completed = true
      } catch {
        if (requestsRef.current !== owner) return
        setWorkflowDetailFailures((prev) => ({ ...prev, [workflowId]: 'more' }))
      } finally {
        if (!completed && owner.pages.get(workflowId) === offset) {
          owner.pages.delete(workflowId)
        }
        if (requestsRef.current === owner) {
          setWorkflowDetails((prev) => {
            const cur = prev[workflowId]
            if (!cur?.__loading || cur.__meta?.key !== owner.key) return prev
            return {
              ...prev,
              [workflowId]: { ...cur, __loading: false },
            }
          })
        }
      }
    },
    [workspaceId, endTime, getStartTime, folderIds, triggers, workflowDetails]
  )

  const loadMoreGlobalLogs = useCallback(async () => {
    const owner = requestsRef.current
    const offset = globalLogsMeta.offset
    if (
      owner.query ||
      owner.globalPage === offset ||
      !globalDetails ||
      !globalLogsMeta.hasMore ||
      globalLogsMeta.key !== owner.key
    )
      return
    owner.globalPage = offset
    let completed = false
    try {
      setWorkflowDetailFailures((prev) => (prev.all ? { ...prev, all: undefined } : prev))
      setGlobalLoadingMore(true)
      const startTime = getStartTime()
      const qp = new URLSearchParams({
        limit: '50',
        offset: String(offset),
        workspaceId,
        startDate: startTime.toISOString(),
        endDate: endTime.toISOString(),
        order: 'desc',
        details: 'full',
      })
      if (workflowIds.length > 0) qp.set('workflowIds', workflowIds.join(','))
      if (folderIds.length > 0) qp.set('folderIds', folderIds.join(','))
      if (triggers.length > 0) qp.set('triggers', triggers.join(','))

      const res = await fetch(`/api/logs?${qp.toString()}`)
      if (requestsRef.current !== owner) return
      if (!res.ok) throw new Error('Global workflow log pagination failed')
      const data = (await res.json()) as LogsResponse
      if (requestsRef.current !== owner) return
      const more = Array.isArray(data.data) ? data.data : []

      setGlobalDetails((prev) => {
        if (!prev || requestsRef.current !== owner) return prev
        if (offset === 0) return { ...prev, logs: more, allLogs: more }
        const seen = new Set<string>()
        const dedup = [...prev.allLogs, ...more].filter((x) => {
          const id = x.id
          if (seen.has(id)) return false
          seen.add(id)
          return true
        })
        return { ...prev, logs: dedup, allLogs: dedup }
      })
      setGlobalLogsMeta((meta) =>
        meta.key === owner.key && meta.offset === offset
          ? {
              offset: offset + more.length,
              hasMore: hasMoreLogs(offset, more.length, data.total),
              key: owner.key,
            }
          : meta
      )
      completed = true
    } catch {
      if (requestsRef.current !== owner) return
      setWorkflowDetailFailures((prev) => ({
        ...prev,
        all: offset === 0 ? 'details' : 'more',
      }))
    } finally {
      if (!completed && owner.globalPage === offset) owner.globalPage = null
      if (requestsRef.current === owner) setGlobalLoadingMore(false)
    }
  }, [
    globalDetails,
    globalLogsMeta,
    workspaceId,
    endTime,
    getStartTime,
    workflowIds,
    folderIds,
    triggers,
  ])

  const toggleWorkflow = useCallback((workflowId: string) => {
    setExpandedWorkflowId((current) => (current === workflowId ? null : workflowId))
  }, [])

  const handleSegmentClick = useCallback(
    (
      workflowId: string,
      segmentIndex: number,
      _timestamp: string,
      mode: 'single' | 'toggle' | 'range'
    ) => {
      if (mode === 'toggle') {
        setSelectedSegments((prev) => {
          const currentSegments = prev[workflowId] || []
          const exists = currentSegments.includes(segmentIndex)
          const nextSegments = exists
            ? currentSegments.filter((i) => i !== segmentIndex)
            : [...currentSegments, segmentIndex].sort((a, b) => a - b)

          if (nextSegments.length === 0) {
            const { [workflowId]: _, ...rest } = prev
            if (Object.keys(rest).length === 0) {
              setExpandedWorkflowId(null)
            }
            return rest
          }

          const newState = { ...prev, [workflowId]: nextSegments }

          const selectedWorkflowIds = Object.keys(newState)
          if (selectedWorkflowIds.length > 1) {
            setExpandedWorkflowId('__multi__')
          } else if (selectedWorkflowIds.length === 1) {
            setExpandedWorkflowId(selectedWorkflowIds[0])
          }

          return newState
        })

        setLastAnchorIndices((prev) => ({ ...prev, [workflowId]: segmentIndex }))
      } else if (mode === 'single') {
        setExpandedWorkflowId(workflowId)
        setSelectedSegments({ [workflowId]: [segmentIndex] })
        setLastAnchorIndices({ [workflowId]: segmentIndex })
      } else if (mode === 'range') {
        if (expandedWorkflowId === workflowId) {
          setSelectedSegments((prev) => {
            const currentSegments = prev[workflowId] || []
            const anchor = lastAnchorIndices[workflowId] ?? segmentIndex
            const [start, end] =
              anchor < segmentIndex ? [anchor, segmentIndex] : [segmentIndex, anchor]
            const range = Array.from({ length: end - start + 1 }, (_, i) => start + i)
            const union = new Set([...currentSegments, ...range])
            return { ...prev, [workflowId]: Array.from(union).sort((a, b) => a - b) }
          })
        } else {
          setExpandedWorkflowId(workflowId)
          setSelectedSegments({ [workflowId]: [segmentIndex] })
          setLastAnchorIndices({ [workflowId]: segmentIndex })
        }
      }
    },
    [expandedWorkflowId, lastAnchorIndices]
  )

  const isInitialMount = useRef(true)
  useEffect(() => {
    const isInitial = isInitialMount.current
    isInitialMount.current = false
    fetchExecutions(isInitial)
  }, [workspaceId, timeRangeMs, endTime, workflowIds, folderIds, triggers, segmentCount])

  useEffect(() => {
    const workflowIdsToLoad =
      expandedWorkflowId === '__multi__'
        ? Object.keys(selectedSegments)
        : expandedWorkflowId
          ? [expandedWorkflowId]
          : []
    for (const workflowId of workflowIdsToLoad) {
      if (workflowDetails[workflowId]?.__meta?.key !== requestKey) {
        void fetchWorkflowDetails(workflowId)
      }
    }
  }, [expandedWorkflowId, selectedSegments, workflowDetails, requestKey, fetchWorkflowDetails])

  useEffect(() => {
    setSelectedSegments({})
    setLastAnchorIndices({})
    setExpandedWorkflowId((current) => (current === '__multi__' ? null : current))
  }, [timeRangeMs, endTime, workflowIds, folderIds, triggers])

  useEffect(() => {
    if (!barsAreaRef.current) return
    const el = barsAreaRef.current
    let debounceId: any = null
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect?.width || 720
      const n = Math.max(36, Math.min(96, Math.floor(w / MIN_SEGMENT_PX)))
      if (debounceId) clearTimeout(debounceId)
      debounceId = setTimeout(() => {
        setSegmentCount(n)
      }, 150)
    })
    ro.observe(el)
    const rect = el.getBoundingClientRect()
    if (rect?.width) {
      const n = Math.max(36, Math.min(96, Math.floor(rect.width / MIN_SEGMENT_PX)))
      setSegmentCount(n)
    }
    return () => {
      if (debounceId) clearTimeout(debounceId)
      ro.disconnect()
    }
  }, [])

  const getDateRange = () => {
    const start = getStartTime()
    return `${start.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} - ${endTime.toLocaleDateString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', year: 'numeric' })}`
  }

  useEffect(() => {
    let interval: any
    if (live) {
      interval = setInterval(() => {
        setEndTime(new Date())
      }, 5000)
    }
    return () => {
      if (interval) clearInterval(interval)
    }
  }, [live])

  useEffect(() => {
    onRefetchingChange(isRefetching)
  }, [isRefetching, onRefetchingChange])

  useEffect(
    () => () => {
      onRefetchingChange(false)
    },
    [onRefetchingChange]
  )

  useEffect(() => {
    if (lastRefreshRequestRef.current === refreshRequest) return
    lastRefreshRequestRef.current = refreshRequest
    void fetchExecutions(false)
  }, [fetchExecutions, refreshRequest])

  const singleExpandedWorkflowId =
    expandedWorkflowId &&
    expandedWorkflowId !== '__multi__' &&
    executions.some((workflow) => workflow.workflowId === expandedWorkflowId)
      ? expandedWorkflowId
      : null

  return (
    <div className={`flex h-full min-w-0 flex-col ${soehne.className}`}>
      <div className='flex min-w-0 flex-1 overflow-hidden'>
        <div
          className='flex flex-1 flex-col overflow-auto p-6'
          style={{ scrollbarGutter: 'stable' }}
        >
          {loading ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='flex items-center gap-2 text-muted-foreground'>
                <Loader2 className='h-5 w-5 animate-spin' />
                <span>{t('loadingExecutionHistory')}</span>
              </div>
            </div>
          ) : error ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='text-destructive'>
                <p className='font-medium'>{t('errorLoadingData')}</p>
                <p className='text-sm'>{error}</p>
              </div>
            </div>
          ) : executions.length === 0 ? (
            <div className='flex flex-1 items-center justify-center'>
              <div className='text-center text-muted-foreground'>
                <p className='font-medium'>{t('noExecutionHistory')}</p>
                <p className='mt-1 text-sm'>{t('noExecutionHistoryDescription')}</p>
              </div>
            </div>
          ) : (
            <Collapsible
              open={Boolean(singleExpandedWorkflowId)}
              onOpenChange={(open) => {
                if (!open && singleExpandedWorkflowId) {
                  toggleWorkflow(singleExpandedWorkflowId)
                }
              }}
            >
              <div className=' top-0 z-10 mb-1 bg-background pb-1'>
                <div className='mb-3 flex flex-wrap items-center gap-3'>
                  <span className='max-w-[40vw] truncate font-[500] text-muted-foreground text-sm'>
                    {getDateRange()}
                  </span>
                  <div className='flex flex-1 flex-wrap items-center justify-end gap-2'>
                    <div className='hidden sm:block'>
                      <Timeline variant='header' />
                    </div>
                    <div className='hidden flex-wrap items-center gap-2 lg:flex'>
                      <div className='min-w-[170px] flex-shrink-0'>
                        <WorkflowFilter />
                      </div>
                      <div className='min-w-[150px] flex-shrink-0'>
                        <FolderFilter />
                      </div>
                      <div className='min-w-[150px] flex-shrink-0'>
                        <TriggerFilter />
                      </div>
                    </div>
                  </div>
                </div>

                <KPIs aggregate={aggregate} />

                <div ref={barsAreaRef} className='mb-1'>
                  <WorkflowsList
                    executions={executions as any}
                    filteredExecutions={filteredExecutions as any}
                    expandedWorkflowId={expandedWorkflowId}
                    onToggleWorkflow={toggleWorkflow}
                    selectedSegments={selectedSegments}
                    onSegmentClick={handleSegmentClick}
                    searchQuery={searchQuery}
                    segmentDurationMs={
                      (endTime.getTime() - getStartTime().getTime()) / Math.max(1, segmentCount)
                    }
                  />
                </div>
              </div>

              <div className='min-h-0 flex-1'>
                {(() => {
                  if (expandedWorkflowId === '__multi__') {
                    const selectedWorkflowIds = Object.keys(selectedSegments)
                    const detailLifecycle = resolveWorkflowDetailLifecycle(
                      selectedWorkflowIds,
                      workflowDetails,
                      workflowDetailFailures,
                      requestKey
                    )
                    const totalMs = endTime.getTime() - getStartTime().getTime()
                    const segMs = totalMs / Math.max(1, segmentCount)

                    const allSegmentIndices = new Set<number>()
                    for (const indices of Object.values(selectedSegments)) {
                      indices.forEach((idx) => allSegmentIndices.add(idx))
                    }
                    const sortedIndices = Array.from(allSegmentIndices).sort((a, b) => a - b)

                    const allLogs: WorkflowLog[] = []
                    let totalExecutions = 0
                    let totalSuccess = 0

                    const aggregatedSegments: Array<{
                      timestamp: string
                      totalExecutions: number
                      successfulExecutions: number
                      avgDurationMs: number
                      durationCount: number
                    }> = []

                    for (const idx of sortedIndices) {
                      let timestamp = ''
                      for (const wfId of selectedWorkflowIds) {
                        const wf = executions.find((w) => w.workflowId === wfId)
                        if (wf?.segments[idx]) {
                          timestamp = wf.segments[idx].timestamp
                          break
                        }
                      }

                      aggregatedSegments.push({
                        timestamp,
                        totalExecutions: 0,
                        successfulExecutions: 0,
                        avgDurationMs: 0,
                        durationCount: 0,
                      })
                    }

                    for (const wfId of selectedWorkflowIds) {
                      const wf = executions.find((w) => w.workflowId === wfId)
                      const storedDetails = workflowDetails[wfId]
                      const details =
                        storedDetails?.__meta?.key === requestKey ? storedDetails : undefined
                      const indices = selectedSegments[wfId] || []

                      if (!wf || indices.length === 0) continue

                      const windows = indices
                        .map((idx) => wf.segments[idx])
                        .filter(Boolean)
                        .map((s) => {
                          const start = new Date(s.timestamp).getTime()
                          const end = start + segMs
                          totalExecutions += s.totalExecutions || 0
                          totalSuccess += s.successfulExecutions || 0
                          return { start, end }
                        })

                      const inAnyWindow = (t: number) =>
                        windows.some((w) => t >= w.start && t < w.end)

                      indices.forEach((idx) => {
                        const segment = wf.segments[idx]
                        if (!segment) return

                        const aggIndex = sortedIndices.indexOf(idx)
                        if (aggIndex >= 0 && aggregatedSegments[aggIndex]) {
                          const agg = aggregatedSegments[aggIndex]
                          agg.totalExecutions += segment.totalExecutions || 0
                          agg.successfulExecutions += segment.successfulExecutions || 0
                          if (segment.avgDurationMs) {
                            agg.avgDurationMs += segment.avgDurationMs
                            agg.durationCount += 1
                          }
                        }
                      })

                      if (details) {
                        allLogs.push(
                          ...details.allLogs.filter((log) =>
                            inAnyWindow(new Date(log.startedAt ?? log.createdAt).getTime())
                          )
                        )
                      }
                    }

                    const errorRates = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value:
                        seg.totalExecutions > 0
                          ? (1 - seg.successfulExecutions / seg.totalExecutions) * 100
                          : 0,
                    }))

                    const executionCounts = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value: seg.totalExecutions,
                    }))

                    const durations = aggregatedSegments.map((seg) => ({
                      timestamp: seg.timestamp,
                      value: seg.durationCount > 0 ? seg.avgDurationMs / seg.durationCount : 0,
                    }))

                    allLogs.sort(
                      (a, b) =>
                        new Date(b.startedAt ?? b.createdAt).getTime() -
                        new Date(a.startedAt ?? a.createdAt).getTime()
                    )

                    const totalFailures = Math.max(totalExecutions - totalSuccess, 0)
                    const totalRate =
                      totalExecutions > 0 ? (totalSuccess / totalExecutions) * 100 : 100

                    return (
                      <WorkflowDetails
                        workspaceId={workspaceId}
                        expandedWorkflowId={'__multi__'}
                        workflowName={tWorkflows('multipleSelected', {
                          count: selectedWorkflowIds.length,
                        })}
                        overview={{
                          total: totalExecutions,
                          success: totalSuccess,
                          failures: totalFailures,
                          rate: totalRate,
                        }}
                        details={
                          detailLifecycle.ready
                            ? ({
                                errorRates,
                                durations,
                                executionCounts,
                                logs: allLogs,
                                allLogs: allLogs,
                              } as any)
                            : undefined
                        }
                        selectedSegmentIndex={[]}
                        selectedSegment={null}
                        clearSegmentSelection={() => {
                          setSelectedSegments({})
                          setLastAnchorIndices({})
                          setExpandedWorkflowId(null)
                        }}
                        formatCost={formatCost}
                        onLoadMore={undefined}
                        hasMore={false}
                        isLoadingMore={false}
                        failureMode={detailLifecycle.failedIds.length ? 'details' : undefined}
                        onRetry={() =>
                          detailLifecycle.failedIds.forEach((id) => void fetchWorkflowDetails(id))
                        }
                      />
                    )
                  }

                  if (expandedWorkflowId) {
                    const wf = executions.find((w) => w.workflowId === expandedWorkflowId)
                    if (!wf) return null
                    const total = wf.segments.reduce((s, x) => s + (x.totalExecutions || 0), 0)
                    const success = wf.segments.reduce(
                      (s, x) => s + (x.successfulExecutions || 0),
                      0
                    )
                    const failures = Math.max(total - success, 0)
                    const rate = total > 0 ? (success / total) * 100 : 100

                    const storedDetails = workflowDetails[expandedWorkflowId]
                    const details =
                      storedDetails?.__meta?.key === requestKey ? storedDetails : undefined
                    let logsToDisplay = details?.logs || []

                    const workflowSelectedIndices = selectedSegments[expandedWorkflowId] || []
                    if (details && workflowSelectedIndices.length > 0) {
                      const totalMs = endTime.getTime() - getStartTime().getTime()
                      const segMs = totalMs / Math.max(1, segmentCount)

                      const windows = workflowSelectedIndices
                        .map((idx) => wf.segments[idx])
                        .filter(Boolean)
                        .map((s) => {
                          const start = new Date(s.timestamp).getTime()
                          const end = start + segMs
                          return { start, end }
                        })

                      const inAnyWindow = (t: number) =>
                        windows.some((w) => t >= w.start && t < w.end)

                      logsToDisplay = details.allLogs.filter((log) =>
                        inAnyWindow(new Date(log.startedAt ?? log.createdAt).getTime())
                      )
                    }

                    const detailsWithFilteredLogs = details
                      ? deriveWorkflowDetailsView(
                          details,
                          wf.segments,
                          workflowSelectedIndices,
                          logsToDisplay
                        )
                      : undefined

                    const selectedSegment =
                      workflowSelectedIndices.length === 1
                        ? wf.segments[workflowSelectedIndices[0]]
                        : null

                    return (
                      <CollapsibleContent>
                        <WorkflowDetails
                          workspaceId={workspaceId}
                          expandedWorkflowId={expandedWorkflowId}
                          workflowName={wf.workflowName}
                          overview={{ total, success, failures, rate }}
                          details={detailsWithFilteredLogs as any}
                          selectedSegmentIndex={workflowSelectedIndices}
                          selectedSegment={
                            selectedSegment
                              ? {
                                  timestamp: selectedSegment.timestamp,
                                  totalExecutions: selectedSegment.totalExecutions,
                                }
                              : null
                          }
                          clearSegmentSelection={() => {
                            setSelectedSegments({})
                            setLastAnchorIndices({})
                          }}
                          formatCost={formatCost}
                          onLoadMore={() => loadMoreLogs(expandedWorkflowId)}
                          hasMore={details?.__meta?.key === requestKey && details.__meta.hasMore}
                          isLoadingMore={details?.__meta?.key === requestKey && details.__loading}
                          failureMode={workflowDetailFailures[expandedWorkflowId]}
                          onRetry={() => {
                            if (workflowDetailFailures[expandedWorkflowId] === 'more') {
                              void loadMoreLogs(expandedWorkflowId)
                            } else {
                              void fetchWorkflowDetails(expandedWorkflowId)
                            }
                          }}
                        />
                      </CollapsibleContent>
                    )
                  }

                  const details = globalLogsMeta.key === requestKey ? globalDetails : undefined
                  const totals = aggregateSegments.reduce(
                    (acc, s) => {
                      acc.total += s.totalExecutions
                      acc.success += s.successfulExecutions
                      return acc
                    },
                    { total: 0, success: 0 }
                  )
                  const failures = Math.max(totals.total - totals.success, 0)
                  const rate = totals.total > 0 ? (totals.success / totals.total) * 100 : 100

                  return (
                    <WorkflowDetails
                      workspaceId={workspaceId}
                      expandedWorkflowId={'all'}
                      workflowName={tWorkflows('allWorkflows')}
                      overview={{ total: totals.total, success: totals.success, failures, rate }}
                      details={details as any}
                      selectedSegmentIndex={[]}
                      selectedSegment={null}
                      clearSegmentSelection={() => {
                        setSelectedSegments({})
                        setLastAnchorIndices({})
                      }}
                      formatCost={formatCost}
                      onLoadMore={loadMoreGlobalLogs}
                      hasMore={globalLogsMeta.key === requestKey && globalLogsMeta.hasMore}
                      isLoadingMore={globalLogsMeta.key === requestKey && globalLoadingMore}
                      failureMode={workflowDetailFailures.all}
                      onRetry={() => void loadMoreGlobalLogs()}
                    />
                  )
                })()}
              </div>
            </Collapsible>
          )}
        </div>
      </div>
    </div>
  )
}
