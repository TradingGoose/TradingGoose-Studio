import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  completePendingExecution,
  isPendingExecutionPayload,
  PENDING_EXECUTION_LOCK_NAMESPACE,
  type PendingExecutionPayload,
} from '@/lib/execution/pending-execution'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type {
  WorkflowExecutionBlueprint,
  WorkflowExecutionTarget,
} from '@/lib/workflows/execution-runner'
import type { TriggerType } from '@/services/queue'

export type PendingExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelling' }
  | { status: 'finished' }

function withCancellationRequest(payload: unknown, cancelledAt: string): PendingExecutionPayload {
  return {
    ...(isPendingExecutionPayload(payload) ? payload : {}),
    cancelRequestedAt: cancelledAt,
  }
}

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

async function readFinishedWorkflowExecutionCancellation(params: {
  executionId: string
  userId: string
}): Promise<PendingExecutionCancellationResult | null> {
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
  return null
}

async function recordQueuedWorkflowCancellation(params: {
  workflowId: string
  executionId: string
  actorUserId: string
  workspaceId: string
  payload: Record<string, unknown>
  requestId?: string
}) {
  const executionTarget: WorkflowExecutionTarget =
    params.payload.executionTarget === 'live' ? 'live' : 'deployed'
  const triggerType =
    typeof params.payload.triggerType === 'string'
      ? (params.payload.triggerType as TriggerType)
      : 'manual'
  const metadata = isRecord(params.payload.metadata) ? params.payload.metadata : undefined
  const triggerData = isRecord(params.payload.triggerData) ? params.payload.triggerData : undefined
  const workflowData =
    executionTarget === 'live'
      ? ((params.payload.workflowData as
          | WorkflowExecutionBlueprint['workflowData']
          | undefined) ?? {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        })
      : {
          blocks: {},
          edges: [],
          loops: {},
          parallels: {},
        }
  const loggingSession = new LoggingSession(
    params.workflowId,
    params.executionId,
    triggerType === 'api-endpoint' ? 'api' : triggerType,
    params.requestId
  )

  await loggingSession.start({
    userId: params.actorUserId,
    workspaceId: params.workspaceId,
    workflowState: workflowData,
    triggerData: metadata ? { ...(triggerData ?? {}), queuedExecution: metadata } : triggerData,
  })
  await loggingSession.completeWithError({
    workspaceId: params.workspaceId,
    error: { message: 'Workflow execution was cancelled' },
    billable: false,
  })
}

export async function cancelPendingWorkflowExecution(params: {
  pendingExecutionId: string
  userId: string
}): Promise<PendingExecutionCancellationResult> {
  const [row] = await db
    .select({
      id: pendingExecution.id,
      billingScopeId: pendingExecution.billingScopeId,
      status: pendingExecution.status,
      payload: pendingExecution.payload,
      workflowId: pendingExecution.workflowId,
      workspaceId: pendingExecution.workspaceId,
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
    return (
      (await readFinishedWorkflowExecutionCancellation({
        executionId: params.pendingExecutionId,
        userId: params.userId,
      })) ?? { status: 'not_found' }
    )
  }

  if (row.status === 'pending') {
    const cancelledAt = new Date().toISOString()
    const payload = withCancellationRequest(row.payload, cancelledAt)
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${row.billingScopeId}))`
      )
      const [claimedRow] = await tx
        .update(pendingExecution)
        .set({
          status: 'processing',
          processingStartedAt: new Date(),
          payload,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'pending')))
        .returning({
          id: pendingExecution.id,
          userId: pendingExecution.userId,
          workflowId: pendingExecution.workflowId,
          workspaceId: pendingExecution.workspaceId,
          payload: pendingExecution.payload,
        })
      return claimedRow
    })

    if (!claimed) {
      return { status: 'not_found' }
    }
    if (!claimed.workflowId || !claimed.workspaceId) {
      throw new Error(`Queued workflow execution ${claimed.id} is missing workflow scope`)
    }

    try {
      await recordQueuedWorkflowCancellation({
        executionId: claimed.id,
        workflowId: claimed.workflowId,
        actorUserId: claimed.userId,
        workspaceId: claimed.workspaceId,
        payload: isPendingExecutionPayload(claimed.payload) ? claimed.payload : {},
        requestId: claimed.id.slice(0, 8),
      })
    } catch (error) {
      await db
        .update(pendingExecution)
        .set({
          status: 'pending',
          processingStartedAt: null,
          payload,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, claimed.id), eq(pendingExecution.status, 'processing')))
      throw error
    }

    await completePendingExecution({ pendingExecutionId: claimed.id })
    return { status: 'cancelling' }
  }

  if (row.status === 'processing') {
    const cancelledAt = new Date().toISOString()
    const payload = withCancellationRequest(row.payload, cancelledAt)

    const cancellingRows = await db
      .update(pendingExecution)
      .set({
        payload,
        updatedAt: new Date(),
      })
      .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
      .returning({ id: pendingExecution.id })

    if (cancellingRows.length > 0) {
      return { status: 'cancelling' }
    }
  }

  return (
    (await readFinishedWorkflowExecutionCancellation({
      executionId: params.pendingExecutionId,
      userId: params.userId,
    })) ?? { status: 'not_found' }
  )
}
