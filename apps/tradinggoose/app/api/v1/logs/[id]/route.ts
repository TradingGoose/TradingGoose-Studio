import { db } from '@tradinggoose/db'
import { permissions, workflow, workflowExecutionLogs, workspace } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { createApiResponse, getUserLimits } from '@/app/api/v1/logs/meta'
import { checkRateLimit, createRateLimitResponse } from '@/app/api/v1/middleware'

const logger = createLogger('V1LogDetailsAPI')

export const revalidate = 0

type WorkflowSummary = {
  id?: string | null
  name?: string | null
  description?: string | null
  color?: string | null
  folderId?: string | null
  userId?: string | null
  workspaceId?: string | null
  createdAt?: string | Date | null
  updatedAt?: string | Date | null
}

const readWorkflowSummary = (value: unknown): WorkflowSummary =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as WorkflowSummary) : {}

const toIsoString = (value: string | Date | null | undefined): string | null => {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : value
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const rateLimit = await checkRateLimit(request, 'logs-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const { id } = await params
    const workspaceAccess = buildWorkspaceAccessScope(userId, workflowExecutionLogs.workspaceId)

    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
        level: workflowExecutionLogs.level,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
        files: workflowExecutionLogs.files,
        createdAt: workflowExecutionLogs.createdAt,
        workspaceId: workflowExecutionLogs.workspaceId,
        workflowSummary: workflowExecutionLogs.workflowSummary,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        workflowColor: workflow.color,
        workflowFolderId: workflow.folderId,
        workflowUserId: workflow.userId,
        workflowWorkspaceId: workflow.workspaceId,
        workflowCreatedAt: workflow.createdAt,
        workflowUpdatedAt: workflow.updatedAt,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(and(eq(workflowExecutionLogs.id, id), workspaceAccess.accessFilter))
      .limit(1)

    const log = rows[0]
    if (!log) {
      return NextResponse.json({ error: 'Log not found' }, { status: 404 })
    }

    const summary = readWorkflowSummary(log.workflowSummary)
    const workflowSummary = {
      id: log.workflowId ?? summary.id ?? null,
      name: log.workflowName ?? summary.name ?? null,
      description: log.workflowDescription ?? summary.description ?? null,
      color: log.workflowColor ?? summary.color ?? null,
      folderId: log.workflowFolderId ?? summary.folderId ?? null,
      userId: log.workflowUserId ?? summary.userId ?? null,
      workspaceId: log.workflowWorkspaceId ?? summary.workspaceId ?? log.workspaceId,
      createdAt: log.workflowCreatedAt?.toISOString() ?? toIsoString(summary.createdAt),
      updatedAt: log.workflowUpdatedAt?.toISOString() ?? toIsoString(summary.updatedAt),
    }

    const response = {
      id: log.id,
      workflowId: workflowSummary.id,
      executionId: log.executionId,
      level: log.level,
      trigger: log.trigger,
      startedAt: log.startedAt.toISOString(),
      endedAt: log.endedAt?.toISOString() || null,
      totalDurationMs: log.totalDurationMs,
      files: log.files || undefined,
      workflow: workflowSummary,
      executionData: log.executionData as any,
      cost: log.cost as any,
      createdAt: log.createdAt.toISOString(),
    }

    // Get user's workflow execution limits and usage
    const limits = await getUserLimits(userId)

    // Create response with limits information
    const apiResponse = createApiResponse({ data: response }, limits, rateLimit)

    return NextResponse.json(apiResponse.body, { headers: apiResponse.headers })
  } catch (error: any) {
    logger.error(`[${requestId}] Log details fetch error`, { error: error.message })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
