import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, or, sql } from 'drizzle-orm'
import { authorizeWorkflowScope } from '@/lib/auth/workflow-scope'
import {
  isPendingExecutionPayload,
  PENDING_EXECUTION_CANCELLATION_ERROR,
  PENDING_EXECUTION_LOCK_NAMESPACE,
  settlePendingExecutionOwner,
} from '@/lib/execution/pending-execution'
import type { WorkflowCheckpointLogData } from '@/lib/workflows/human-in-the-loop/types'

export type PendingExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelling' }
  | { status: 'finished' }

async function readWorkflowExecutionCancellationResult(params: {
  executionId: string
  userId: string
  workspaceId?: string
}): Promise<PendingExecutionCancellationResult> {
  const [logRow] = await db
    .select({
      endedAt: workflowExecutionLogs.endedAt,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, params.executionId),
        sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${params.userId}`,
        ...(params.workspaceId ? [eq(workflowExecutionLogs.workspaceId, params.workspaceId)] : [])
      )
    )
    .limit(1)

  if (logRow?.endedAt) {
    return { status: 'finished' }
  }
  return { status: 'not_found' }
}

export async function cancelPendingWorkflowExecution(params: {
  pendingExecutionId: string
  userId: string
  workspaceId?: string
  /** Trusted worker cleanup after an authorized parent cancellation, never supplied by API input. */
  descendantCancellation?: boolean
  wake?: boolean
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
        eq(pendingExecution.executionType, 'workflow'),
        ...(params.workspaceId ? [eq(pendingExecution.workspaceId, params.workspaceId)] : [])
      )
    )
    .limit(1)

  if (
    !row ||
    !row.workflowId ||
    row.status === 'processing' ||
    (isPendingExecutionPayload(row.payload) && row.payload.resumeExecutionId)
  ) {
    const [log] = await db
      .select()
      .from(workflowExecutionLogs)
      .where(
        and(
          or(
            eq(workflowExecutionLogs.executionId, params.pendingExecutionId),
            sql`${workflowExecutionLogs.executionData}->'checkpoint'->>'activeJobId' = ${params.pendingExecutionId}`
          ),
          sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${params.userId}`,
          ...(params.workspaceId ? [eq(workflowExecutionLogs.workspaceId, params.workspaceId)] : [])
        )
      )
      .limit(1)
    if (log?.workflowId && (log.executionData as WorkflowCheckpointLogData).checkpoint) {
      if (!params.descendantCancellation) {
        const access = await authorizeWorkflowScope(
          { success: true, userId: params.userId },
          log.workflowId,
          'write'
        )
        if (!access.ok || access.workspaceId !== log.workspaceId) return { status: 'not_found' }
      }
      const decision = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(workflowExecutionLogs)
          .where(eq(workflowExecutionLogs.id, log.id))
          .for('update')
          .limit(1)
        if (!current || current.endedAt) return null
        const data = current.executionData as WorkflowCheckpointLogData
        const checkpoint = data.checkpoint
        if (!checkpoint) return null
        if (checkpoint.activeJobId) {
          const active = await tx
            .update(pendingExecution)
            .set({
              payload: sql`${pendingExecution.payload} || jsonb_build_object('cancelRequestedAt', ${new Date().toISOString()})`,
              updatedAt: new Date(),
            })
            .where(eq(pendingExecution.id, checkpoint.activeJobId))
            .returning({ id: pendingExecution.id })
          if (active.length) return { active: true }
        }
        const { pause: _pause, ...cancelledData } = data
        await tx
          .update(workflowExecutionLogs)
          .set({
            executionData: { ...cancelledData, checkpoint: { ...checkpoint, activeJobId: null } },
          })
          .where(eq(workflowExecutionLogs.id, current.id))
        return { active: false }
      })
      if (!decision) return { status: 'finished' }
      if (!decision.active) {
        const { terminalizeWorkflowExecution } = await import(
          '@/background/pending-execution-worker'
        )
        await terminalizeWorkflowExecution(
          {
            id: log.executionId,
            executionType: 'workflow',
            source: 'human_in_the_loop',
            workflowId: log.workflowId,
            workspaceId: log.workspaceId,
            userId: params.userId,
            payload: { resumeExecutionId: log.executionId },
          },
          0,
          PENDING_EXECUTION_CANCELLATION_ERROR
        )
      }
      if (!params.descendantCancellation) {
        const { cancelPendingExecutionDescendants } = await import(
          '@/background/pending-execution-worker'
        )
        await cancelPendingExecutionDescendants(log.executionId)
      }
      return { status: 'cancelling' }
    }
    if (!row || !row.workflowId) {
      return readWorkflowExecutionCancellationResult({
        executionId: params.pendingExecutionId,
        userId: params.userId,
        workspaceId: params.workspaceId,
      })
    }
  }

  if (row.status === 'pending') {
    const cancellationPayload = {
      ...(isPendingExecutionPayload(row.payload) ? row.payload : {}),
      cancelRequestedAt: new Date().toISOString(),
    }
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${row.billingScopeId}))`
      )
      const [claimedRow] = await tx
        .update(pendingExecution)
        .set({
          status: 'processing',
          processingStartedAt: new Date(),
          payload: cancellationPayload,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'pending')))
        .returning({
          id: pendingExecution.id,
          userId: pendingExecution.userId,
          workflowId: pendingExecution.workflowId,
          workspaceId: pendingExecution.workspaceId,
          source: pendingExecution.source,
          payload: pendingExecution.payload,
        })
      return claimedRow
    })

    if (!claimed) {
      return readWorkflowExecutionCancellationResult({
        executionId: params.pendingExecutionId,
        userId: params.userId,
        workspaceId: params.workspaceId,
      })
    }
    if (!claimed.workflowId || !claimed.workspaceId) {
      throw new Error(`Queued workflow execution ${claimed.id} is missing workflow scope`)
    }

    try {
      const { terminalizeWorkflowExecution } = await import('@/background/pending-execution-worker')
      const payload = isPendingExecutionPayload(claimed.payload) ? claimed.payload : {}
      await terminalizeWorkflowExecution(
        { ...claimed, executionType: 'workflow', payload },
        0,
        PENDING_EXECUTION_CANCELLATION_ERROR,
        typeof payload.resumeExecutionId === 'string'
      )
    } catch (error) {
      await db
        .update(pendingExecution)
        .set({
          status: 'pending',
          processingStartedAt: null,
          payload: cancellationPayload,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, claimed.id), eq(pendingExecution.status, 'processing')))
      throw error
    }

    await settlePendingExecutionOwner(claimed, { wake: params.wake })
    return { status: 'cancelling' }
  }

  if (row.status === 'processing') {
    const cancelRequestedAt = new Date().toISOString()

    const cancellingRows = await db
      .update(pendingExecution)
      .set({
        payload: sql`${pendingExecution.payload} || jsonb_build_object('cancelRequestedAt', ${cancelRequestedAt})`,
        updatedAt: new Date(),
      })
      .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
      .returning({ id: pendingExecution.id })

    if (cancellingRows.length > 0) {
      return { status: 'cancelling' }
    }
  }

  return readWorkflowExecutionCancellationResult({
    executionId: params.pendingExecutionId,
    userId: params.userId,
    workspaceId: params.workspaceId,
  })
}
