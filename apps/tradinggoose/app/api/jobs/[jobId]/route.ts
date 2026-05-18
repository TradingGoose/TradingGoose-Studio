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
import { cancelPendingWorkflowExecution } from '@/lib/execution/pending-execution'
import { createWorkflowExecutionResultFromLog } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { buildWorkspaceAccessScope } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  createInternalWorkflowJobResult,
  createPublicExecutionResult,
  isExecutionResult,
} from '@/lib/workflows/execution-result'
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

    const [pendingRow] = await db
      .select({
        id: pendingExecution.id,
        status: pendingExecution.status,
        createdAt: pendingExecution.createdAt,
        processingStartedAt: pendingExecution.processingStartedAt,
      })
      .from(pendingExecution)
      .where(and(eq(pendingExecution.id, taskId), eq(pendingExecution.userId, auth.userId)))
      .limit(1)

    if (pendingRow) {
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
      auth.apiKeyType === 'workspace' && auth.workspaceId
        ? eq(workflowExecutionLogs.workspaceId, auth.workspaceId)
        : workspaceAccess.accessFilter
    const [logRow] = await db
      .select({
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
      const state = createWorkflowExecutionResultFromLog(logRow)
      return NextResponse.json({
        success: true,
        taskId,
        status: state.status,
        ...(state.status === 'completed' && isExecutionResult(state.result)
          ? {
              output: shouldIncludeInternalWorkflowTraceSpans(auth, state.result)
                ? createInternalWorkflowJobResult(state.result)
                : createPublicExecutionResult(state.result),
            }
          : state.status === 'failed'
            ? { error: state.errorMessage ?? 'Execution failed' }
            : { estimatedDuration: 180000 }),
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

    const result = await cancelPendingWorkflowExecution({
      pendingExecutionId: taskId,
      userId: auth.userId,
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
