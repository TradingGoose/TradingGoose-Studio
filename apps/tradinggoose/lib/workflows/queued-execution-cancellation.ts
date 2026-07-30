import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { cancelWorkflowExecutionAtomically } from '@/lib/execution/workflow-execution-lifecycle-repository'

export type PendingExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelling' }
  | { status: 'finished' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function readExecutionUserId(executionData: unknown) {
  const data = isRecord(executionData) ? executionData : {}
  const environment = isRecord(data.environment) ? data.environment : {}
  return typeof environment.userId === 'string' && environment.userId.length > 0
    ? environment.userId
    : null
}

async function readWorkflowExecutionCancellationResult(params: {
  executionId: string
  userId: string
}): Promise<PendingExecutionCancellationResult> {
  const [logRow] = await db
    .select({
      endedAt: workflowExecutionLogs.endedAt,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, params.executionId))
    .limit(1)

  if (logRow?.endedAt && readExecutionUserId(logRow.executionData) === params.userId) {
    return { status: 'finished' }
  }
  return { status: 'not_found' }
}

export async function cancelPendingWorkflowExecution(params: {
  pendingExecutionId: string
  userId: string
  descendantOnly?: boolean
}): Promise<PendingExecutionCancellationResult> {
  const [row] = await db
    .select({
      id: pendingExecution.id,
      workflowId: pendingExecution.workflowId,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.userId, params.userId),
        eq(pendingExecution.executionType, 'workflow')
      )
    )
    .limit(1)

  if (!row || !row.workflowId) {
    return readWorkflowExecutionCancellationResult({
      executionId: params.pendingExecutionId,
      userId: params.userId,
    })
  }

  if (
    await cancelWorkflowExecutionAtomically({
      pendingExecutionId: row.id,
      actorUserId: params.userId,
      descendantOnly: params.descendantOnly,
    })
  ) {
    return { status: 'cancelling' }
  }

  return readWorkflowExecutionCancellationResult({
    executionId: params.pendingExecutionId,
    userId: params.userId,
  })
}
