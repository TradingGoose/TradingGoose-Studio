import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import {
  completePendingExecution,
  isPendingExecutionPayload,
  type PendingExecutionPayload,
} from '@/lib/execution/pending-execution'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import {
  loadWorkflowExecutionBlueprint,
  type WorkflowExecutionBlueprint,
  type WorkflowExecutionTarget,
} from '@/lib/workflows/execution-runner'
import type { TriggerType } from '@/services/queue'

export type PendingExecutionCancellationResult = { status: 'not_found' } | { status: 'cancelling' }

function withCancellationRequest(payload: unknown, cancelledAt: string): PendingExecutionPayload {
  return {
    ...(isPendingExecutionPayload(payload) ? payload : {}),
    cancelRequestedAt: cancelledAt,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
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
  const workflowVariables = isRecord(params.payload.workflowVariables)
    ? params.payload.workflowVariables
    : undefined
  const metadata = isRecord(params.payload.metadata) ? params.payload.metadata : undefined
  const triggerData = isRecord(params.payload.triggerData) ? params.payload.triggerData : undefined
  const blueprint = await loadWorkflowExecutionBlueprint({
    workflowId: params.workflowId,
    executionTarget,
    workflowContext: {
      workspaceId: params.workspaceId,
      variables: executionTarget === 'live' ? workflowVariables : undefined,
    },
    workflowData:
      executionTarget === 'live'
        ? (params.payload.workflowData as WorkflowExecutionBlueprint['workflowData'] | undefined)
        : undefined,
  })
  const loggingSession = new LoggingSession(
    params.workflowId,
    params.executionId,
    triggerType === 'api-endpoint' ? 'api' : triggerType,
    params.requestId
  )

  await loggingSession.start({
    userId: params.actorUserId,
    workspaceId: params.workspaceId,
    workflowState: blueprint.workflowData,
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
      status: pendingExecution.status,
      payload: pendingExecution.payload,
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
    return { status: 'not_found' }
  }

  if (row.status === 'pending') {
    const cancelledAt = new Date().toISOString()
    const payload = withCancellationRequest(row.payload, cancelledAt)
    const [claimed] = await db
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
    } finally {
      await completePendingExecution({ pendingExecutionId: claimed.id })
    }
    return { status: 'cancelling' }
  }

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

  return { status: 'not_found' }
}
