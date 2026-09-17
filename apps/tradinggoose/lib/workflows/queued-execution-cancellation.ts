import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
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

  const executionId =
    isPendingExecutionPayload(row?.payload) && typeof row.payload.resumeExecutionId === 'string'
      ? row.payload.resumeExecutionId
      : params.pendingExecutionId
  const cancellation = {
    payload: sql`${pendingExecution.payload} || jsonb_build_object('cancelRequestedAt', ${new Date().toISOString()})`,
    updatedAt: new Date(),
  }
  let processingCancellationRequested = false
  if (row?.status === 'processing' && row.workflowId) {
    if (!params.descendantCancellation) {
      const access = await authorizeWorkflowScope(
        { success: true, userId: params.userId },
        row.workflowId,
        'write'
      )
      if (!access.ok || access.workspaceId !== row.workspaceId) return { status: 'not_found' }
    }
    const cancellingRows = await db
      .update(pendingExecution)
      .set(cancellation)
      .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
      .returning({ id: pendingExecution.id })
    processingCancellationRequested = cancellingRows.length > 0
  }

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
          eq(workflowExecutionLogs.executionId, executionId),
          sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${params.userId}`,
          ...(params.workspaceId ? [eq(workflowExecutionLogs.workspaceId, params.workspaceId)] : [])
        )
      )
      .limit(1)
    if (
      log?.workflowId &&
      (row?.status === 'processing' || (log.executionData as WorkflowCheckpointLogData).checkpoint)
    ) {
      if (
        !params.descendantCancellation &&
        !(
          row?.status === 'processing' &&
          row.workflowId === log.workflowId &&
          row.workspaceId === log.workspaceId
        )
      ) {
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
        const activeJobId = checkpoint?.activeJobId
        if (activeJobId) {
          if (processingCancellationRequested && activeJobId === row?.id) return { active: true }
          const active = await tx
            .update(pendingExecution)
            .set(cancellation)
            .where(eq(pendingExecution.id, activeJobId))
            .returning({ id: pendingExecution.id })
          if (active.length) return { active: true }
        }
        if (!checkpoint) return processingCancellationRequested ? { active: true } : null
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
  }

  if (row?.workflowId && row.status === 'pending') {
    const claimed = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${row.billingScopeId}))`
      )
      const [claimedRow] = await tx
        .update(pendingExecution)
        .set({
          ...cancellation,
          status: 'processing',
          processingStartedAt: new Date(),
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

    if (claimed) {
      if (!claimed.workflowId || !claimed.workspaceId) {
        throw new Error(`Queued workflow execution ${claimed.id} is missing workflow scope`)
      }
      try {
        const { terminalizeWorkflowExecution } = await import(
          '@/background/pending-execution-worker'
        )
        if (!isPendingExecutionPayload(claimed.payload)) {
          throw new Error(`Queued workflow execution ${claimed.id} has an invalid payload`)
        }
        await terminalizeWorkflowExecution(
          { ...claimed, executionType: 'workflow', payload: claimed.payload },
          0,
          PENDING_EXECUTION_CANCELLATION_ERROR,
          typeof claimed.payload.resumeExecutionId === 'string'
        )
      } catch (error) {
        await db
          .update(pendingExecution)
          .set({ ...cancellation, status: 'pending', processingStartedAt: null })
          .where(
            and(eq(pendingExecution.id, claimed.id), eq(pendingExecution.status, 'processing'))
          )
        throw error
      }

      await settlePendingExecutionOwner(claimed, { wake: params.wake })
      return { status: 'cancelling' }
    }
  }

  if (processingCancellationRequested) return { status: 'cancelling' }

  return readWorkflowExecutionCancellationResult({
    executionId,
    userId: params.userId,
    workspaceId: params.workspaceId,
  })
}
