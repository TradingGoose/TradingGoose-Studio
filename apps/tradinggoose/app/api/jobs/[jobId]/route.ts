import { db } from '@tradinggoose/db'
import {
  pendingExecution,
  permissions,
  workflowExecutionLogs,
  workspace,
} from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { type AuthResult, AuthType, checkHybridAuth } from '@/lib/auth/hybrid'
import { createWorkflowExecutionResultFromLog } from '@/lib/execution/workflow-execution-events'
import { openWorkflowExecutionEventStream } from '@/lib/execution/workflow-execution-stream'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope, checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId, SSE_HEADERS } from '@/lib/utils'
import {
  createInternalWorkflowJobResult,
  createPublicExecutionResult,
  isExecutionResult,
} from '@/lib/workflows/execution-result'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('TaskStatusAPI')

function shouldIncludeInternalWorkflowTraceSpans(auth: AuthResult, result: unknown) {
  if (auth.authType !== AuthType.INTERNAL_JWT || !auth.internalWorkflowExecution) return false
  const queuedExecution = (result as { metadata?: { queuedExecution?: Record<string, unknown> } })
    .metadata?.queuedExecution
  return (
    queuedExecution?.source === 'workflow_block' &&
    queuedExecution.parentBlockId === auth.internalWorkflowExecution.parentBlockId &&
    queuedExecution.parentExecutionId === auth.internalWorkflowExecution.parentExecutionId
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: taskId } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Getting status for task: ${taskId}`)

    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createErrorResponse('Authentication required', 401)
    }

    const workspaceKey = auth.authType === AuthType.API_KEY && auth.apiKeyType === 'workspace'
    if (workspaceKey && !auth.workspaceId) {
      return createErrorResponse('Workspace API key is missing its workspace scope', 403)
    }

    const streaming = request.headers.get('accept')?.includes('text/event-stream')
    const fromEventId = Number(request.headers.get('last-event-id') ?? 0)
    if (streaming && (!Number.isSafeInteger(fromEventId) || fromEventId < 0)) {
      return createErrorResponse('Invalid workflow execution event cursor', 400)
    }
    const streamExecution = async (workflowId: string) => {
      const result = await openWorkflowExecutionEventStream({
        pendingExecutionId: taskId,
        workflowId,
        fromEventId,
        requestId,
      })
      return result.ok
        ? new NextResponse(result.stream, { headers: SSE_HEADERS })
        : createErrorResponse('Task not found', 404)
    }

    const [pendingRow] = await db
      .select({
        id: pendingExecution.id,
        workflowId: pendingExecution.workflowId,
        workspaceId: pendingExecution.workspaceId,
        status: pendingExecution.status,
        createdAt: pendingExecution.createdAt,
        processingStartedAt: pendingExecution.processingStartedAt,
      })
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, taskId),
          eq(pendingExecution.userId, auth.userId),
          ...(workspaceKey ? [eq(pendingExecution.workspaceId, auth.workspaceId!)] : [])
        )
      )
      .limit(1)

    if (pendingRow) {
      if (streaming) {
        if (
          !pendingRow.workflowId ||
          !pendingRow.workspaceId ||
          !(await checkWorkspaceAccess(pendingRow.workspaceId, auth.userId)).hasAccess
        )
          return createErrorResponse('Task not found', 404)
        return await streamExecution(pendingRow.workflowId)
      }
      return NextResponse.json({
        success: true,
        taskId,
        status: pendingRow.status === 'pending' ? 'queued' : pendingRow.status,
        estimatedDuration: 180000,
        metadata: {
          startedAt: pendingRow.processingStartedAt ?? pendingRow.createdAt,
        },
      })
    }

    const workspaceAccess = buildWorkspaceAccessScope(
      auth.userId,
      workflowExecutionLogs.workspaceId
    )
    const accessFilter =
      workspaceKey && auth.workspaceId
        ? eq(workflowExecutionLogs.workspaceId, auth.workspaceId)
        : workspaceAccess.accessFilter
    const [logRow] = await db
      .select({
        id: workflowExecutionLogs.id,
        workspaceId: workflowExecutionLogs.workspaceId,
        executionId: workflowExecutionLogs.executionId,
        workflowId: workflowExecutionLogs.workflowId,
        workflowSummary: workflowExecutionLogs.workflowSummary,
        level: workflowExecutionLogs.level,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .innerJoin(workspace, workspaceAccess.workspaceJoin)
      .leftJoin(permissions, workspaceAccess.permissionJoin)
      .where(and(eq(workflowExecutionLogs.executionId, taskId), accessFilter))
      .limit(1)

    if (logRow) {
      if (streaming && logRow.workflowId) return await streamExecution(logRow.workflowId)
      const state = createWorkflowExecutionResultFromLog(logRow)
      const output = isExecutionResult(state.result)
        ? shouldIncludeInternalWorkflowTraceSpans(auth, state.result)
          ? createInternalWorkflowJobResult(state.result)
          : createPublicExecutionResult(state.result)
        : null
      return NextResponse.json({
        success: true,
        taskId,
        status: state.status,
        ...(output ? { output } : {}),
        ...(state.status === 'failed'
          ? { error: state.failureReason ?? 'Execution failed' }
          : state.status === 'processing'
            ? { estimatedDuration: 180000 }
            : {}),
        metadata: {
          startedAt: logRow.startedAt,
          ...(logRow.endedAt ? { completedAt: logRow.endedAt } : {}),
        },
      })
    }

    return createErrorResponse('Task not found', 404)
  } catch (error: any) {
    logger.error(`[${requestId}] Error fetching task status:`, error)
    return createErrorResponse('Failed to fetch task status', 500)
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId: taskId } = await params
  const requestId = generateRequestId()

  try {
    logger.debug(`[${requestId}] Cancelling task: ${taskId}`)

    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return createErrorResponse('Authentication required', 401)
    }

    if (
      auth.authType === AuthType.API_KEY &&
      auth.apiKeyType === 'workspace' &&
      !auth.workspaceId
    ) {
      return createErrorResponse('Workspace API key is missing its workspace scope', 403)
    }

    const result = await cancelPendingWorkflowExecution({
      pendingExecutionId: taskId,
      userId: auth.userId,
      ...(auth.authType === AuthType.API_KEY && auth.apiKeyType === 'workspace'
        ? { workspaceId: auth.workspaceId ?? '' }
        : {}),
    })

    if (result.status === 'not_found') {
      return createErrorResponse('Task not found', 404)
    }

    return NextResponse.json({
      success: true,
      taskId,
      status: result.status,
    })
  } catch (error: any) {
    logger.error(`[${requestId}] Error cancelling task:`, error)
    return createErrorResponse('Failed to cancel task', 500)
  }
}
