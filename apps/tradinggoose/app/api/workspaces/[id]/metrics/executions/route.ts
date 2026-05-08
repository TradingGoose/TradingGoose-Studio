import { db } from '@tradinggoose/db'
import { permissions, workflow, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('MetricsExecutionsAPI')

const QueryParamsSchema = z.object({
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  segments: z.coerce.number().min(1).max(200).default(72),
  workflowIds: z.string().optional(),
  folderIds: z.string().optional(),
  triggers: z.string().optional(),
})

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: workspaceId } = await params
    const { searchParams } = new URL(request.url)
    const qp = QueryParamsSchema.parse(Object.fromEntries(searchParams.entries()))
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = session.user.id

    const end = qp.endTime ? new Date(qp.endTime) : new Date()
    const start = qp.startTime
      ? new Date(qp.startTime)
      : new Date(end.getTime() - 24 * 60 * 60 * 1000)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
      return NextResponse.json({ error: 'Invalid time range' }, { status: 400 })
    }

    const segments = qp.segments
    const totalMs = Math.max(1, end.getTime() - start.getTime())
    const segmentMs = Math.max(1, Math.floor(totalMs / Math.max(1, segments)))

    const [permission] = await db
      .select()
      .from(permissions)
      .where(
        and(
          eq(permissions.entityType, 'workspace'),
          eq(permissions.entityId, workspaceId),
          eq(permissions.userId, userId)
        )
      )
      .limit(1)
    if (!permission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const workflowIds = qp.workflowIds?.split(',').filter(Boolean) ?? []
    const folderIds = qp.folderIds?.split(',').filter(Boolean) ?? []
    const wfWhere = [eq(workflow.workspaceId, workspaceId)] as any[]
    if (folderIds.length > 0) {
      wfWhere.push(inArray(workflow.folderId, folderIds))
    }
    if (workflowIds.length > 0) {
      wfWhere.push(inArray(workflow.id, workflowIds))
    }

    const workflows = await db
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(and(...wfWhere))

    const logWhere = [
      eq(workflowExecutionLogs.workspaceId, workspaceId),
      gte(workflowExecutionLogs.startedAt, start),
      lte(workflowExecutionLogs.startedAt, end),
    ] as any[]
    if (workflowIds.length > 0) {
      logWhere.push(
        or(
          inArray(workflowExecutionLogs.workflowId, workflowIds),
          inArray(sql<string>`${workflowExecutionLogs.workflowSummary}->>'id'`, workflowIds)
        )
      )
    }
    if (folderIds.length > 0) {
      logWhere.push(
        inArray(
          sql<string>`COALESCE(${workflow.folderId}, ${workflowExecutionLogs.workflowSummary}->>'folderId')`,
          folderIds
        )
      )
    }
    if (qp.triggers) {
      const t = qp.triggers.split(',').filter(Boolean)
      logWhere.push(inArray(workflowExecutionLogs.trigger, t))
    }

    const logs = await db
      .select({
        workflowId: workflowExecutionLogs.workflowId,
        workflowSummary: workflowExecutionLogs.workflowSummary,
        workflowName: workflow.name,
        level: workflowExecutionLogs.level,
        startedAt: workflowExecutionLogs.startedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(and(...logWhere))

    type Bucket = {
      timestamp: string
      totalExecutions: number
      successfulExecutions: number
      durations: number[]
    }

    const wfIdToBuckets = new Map<string, Bucket[]>()
    const workflowNameById = new Map(workflows.map((wf) => [wf.id, wf.name]))
    for (const wf of workflows) {
      const buckets: Bucket[] = Array.from({ length: segments }, (_, i) => ({
        timestamp: new Date(start.getTime() + i * segmentMs).toISOString(),
        totalExecutions: 0,
        successfulExecutions: 0,
        durations: [],
      }))
      wfIdToBuckets.set(wf.id, buckets)
    }

    for (const log of logs) {
      const workflowSummary = log.workflowSummary as { id?: string; name?: string } | null
      const workflowId = log.workflowId ?? workflowSummary?.id
      if (!workflowId) continue
      if (!workflowNameById.has(workflowId)) {
        workflowNameById.set(
          workflowId,
          log.workflowName ?? workflowSummary?.name ?? 'Deleted workflow'
        )
      }

      const idx = Math.min(
        segments - 1,
        Math.max(0, Math.floor((log.startedAt.getTime() - start.getTime()) / segmentMs))
      )
      let buckets = wfIdToBuckets.get(workflowId)
      if (!buckets) {
        buckets = Array.from({ length: segments }, (_, i) => ({
          timestamp: new Date(start.getTime() + i * segmentMs).toISOString(),
          totalExecutions: 0,
          successfulExecutions: 0,
          durations: [],
        }))
        wfIdToBuckets.set(workflowId, buckets)
      }
      if (!buckets) continue
      const b = buckets[idx]
      b.totalExecutions += 1
      if ((log.level || '').toLowerCase() !== 'error') b.successfulExecutions += 1
      if (typeof log.totalDurationMs === 'number') b.durations.push(log.totalDurationMs)
    }

    function percentile(arr: number[], p: number): number {
      if (arr.length === 0) return 0
      const sorted = [...arr].sort((a, b) => a - b)
      const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))
      return sorted[idx]
    }

    const result = Array.from(wfIdToBuckets.entries()).map(([workflowId, buckets]) => {
      const segmentsOut = buckets.map((b) => {
        const avg =
          b.durations.length > 0
            ? Math.round(b.durations.reduce((s, d) => s + d, 0) / b.durations.length)
            : 0
        const p50 = percentile(b.durations, 50)
        const p90 = percentile(b.durations, 90)
        const p99 = percentile(b.durations, 99)
        return {
          timestamp: b.timestamp,
          totalExecutions: b.totalExecutions,
          successfulExecutions: b.successfulExecutions,
          avgDurationMs: avg,
          p50Ms: p50,
          p90Ms: p90,
          p99Ms: p99,
        }
      })
      return {
        workflowId,
        workflowName: workflowNameById.get(workflowId) ?? 'Deleted workflow',
        segments: segmentsOut,
      }
    })

    return NextResponse.json({
      workflows: result,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      segmentMs,
    })
  } catch (error) {
    logger.error('MetricsExecutionsAPI error', error)
    return NextResponse.json({ error: 'Failed to compute metrics' }, { status: 500 })
  }
}
