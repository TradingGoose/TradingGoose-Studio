import { setTimeout as delay } from 'node:timers/promises'
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
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { WorkflowCheckpointLogData } from '@/lib/workflows/human-in-the-loop/types'

type PendingExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelling' | 'finished'; pendingExecutionId?: string }

type WorkflowCancellationTarget = {
  pendingExecutionId: string
  userId: string
  workspaceId?: string
  workflowId?: string
}

function workflowOwnerScope(target: WorkflowCancellationTarget) {
  return and(
    eq(pendingExecution.userId, target.userId),
    eq(pendingExecution.executionType, 'workflow'),
    target.workflowId ? eq(pendingExecution.workflowId, target.workflowId) : undefined,
    target.workspaceId ? eq(pendingExecution.workspaceId, target.workspaceId) : undefined
  )
}

export async function cancelPendingWorkflowExecution(
  params: WorkflowCancellationTarget & {
    /** Trusted worker cleanup after an authorized parent cancellation, never supplied by API input. */
    descendantCancellation?: boolean
    wake?: boolean
  }
): Promise<PendingExecutionCancellationResult> {
  let [row] = await db
    .select({
      id: pendingExecution.id,
      billingScopeId: pendingExecution.billingScopeId,
      status: pendingExecution.status,
      payload: pendingExecution.payload,
      workflowId: pendingExecution.workflowId,
      workspaceId: pendingExecution.workspaceId,
    })
    .from(pendingExecution)
    .where(and(eq(pendingExecution.id, params.pendingExecutionId), workflowOwnerScope(params)))
    .limit(1)

  const executionId =
    isPendingExecutionPayload(row?.payload) && typeof row.payload.resumeExecutionId === 'string'
      ? row.payload.resumeExecutionId
      : params.pendingExecutionId
  const executionLogScope = and(
    eq(workflowExecutionLogs.executionId, executionId),
    sql`${workflowExecutionLogs.executionData}->'environment'->>'userId' = ${params.userId}`,
    params.workflowId
      ? eq(
          sql<string>`coalesce(${workflowExecutionLogs.workflowId}, ${workflowExecutionLogs.workflowSummary}->>'id')`,
          params.workflowId
        )
      : undefined,
    ...(params.workspaceId ? [eq(workflowExecutionLogs.workspaceId, params.workspaceId)] : [])
  )
  const cancelDescendants = async () => {
    if (params.descendantCancellation) return
    const { cancelPendingExecutionDescendants } = await import(
      '@/background/pending-execution-worker'
    )
    await cancelPendingExecutionDescendants(executionId)
  }
  const cancellation = {
    payload: sql`${pendingExecution.payload} || jsonb_build_object('cancelRequestedAt', ${new Date().toISOString()}::text)`,
    updatedAt: new Date(),
  }
  let cancellationOwnerId: string | undefined
  const checkRowAccess = row?.status === 'processing' || Boolean(params.workflowId)
  if (row?.workflowId && checkRowAccess && !params.descendantCancellation) {
    const access = await authorizeWorkflowScope(
      { success: true, userId: params.userId },
      row.workflowId,
      'write'
    )
    if (!access.ok || access.workspaceId !== row.workspaceId) return { status: 'not_found' }
  }
  if (row?.status === 'processing' && row.workflowId) {
    const cancellingRows = await db
      .update(pendingExecution)
      .set(cancellation)
      .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
      .returning({ id: pendingExecution.id })
    cancellationOwnerId = cancellingRows[0]?.id
  }

  if (
    !row ||
    !row.workflowId ||
    row.status === 'processing' ||
    (isPendingExecutionPayload(row.payload) && row.payload.resumeExecutionId)
  ) {
    const [log] = await db.select().from(workflowExecutionLogs).where(executionLogScope).limit(1)
    if (
      log?.workflowId &&
      (!params.workflowId || !log.endedAt || row?.status === 'processing') &&
      (row?.status === 'processing' || (log.executionData as WorkflowCheckpointLogData).checkpoint)
    ) {
      if (
        !params.descendantCancellation &&
        !(
          checkRowAccess &&
          row?.workflowId === log.workflowId &&
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
        if (!current) return 'not_found' as const
        if (current.endedAt) return 'finished' as const
        const data = current.executionData as WorkflowCheckpointLogData
        const checkpoint = data.checkpoint
        const activeJobId = checkpoint?.activeJobId
        if (activeJobId) {
          if (activeJobId === cancellationOwnerId)
            return { active: true, pendingExecutionId: activeJobId }
          const [active] = await tx
            .update(pendingExecution)
            .set(cancellation)
            .where(eq(pendingExecution.id, activeJobId))
            .returning()
          if (active)
            return {
              active: true,
              pendingExecutionId: activeJobId,
              queued: active.status === 'pending' ? active : undefined,
            }
        }
        if (!checkpoint)
          return cancellationOwnerId
            ? { active: true, pendingExecutionId: cancellationOwnerId }
            : ('not_found' as const)
        const { pause: _pause, ...cancelledData } = data
        await tx
          .update(workflowExecutionLogs)
          .set({
            executionData: { ...cancelledData, checkpoint: { ...checkpoint, activeJobId: null } },
          })
          .where(eq(workflowExecutionLogs.id, current.id))
        return { active: false, pendingExecutionId: cancellationOwnerId }
      })
      if (decision === 'not_found') return { status: 'not_found' }
      if (decision === 'finished')
        return { status: 'finished', pendingExecutionId: cancellationOwnerId }
      if (decision.queued) {
        row = decision.queued
        cancellationOwnerId = decision.pendingExecutionId
      } else {
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
        await cancelDescendants()
        return { status: 'cancelling', pendingExecutionId: decision.pendingExecutionId }
      }
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

      if (cancellationOwnerId) await cancelDescendants()
      await settlePendingExecutionOwner(claimed, { wake: params.wake })
      return { status: 'cancelling' }
    }
  }

  if (cancellationOwnerId) {
    await cancelDescendants()
    return { status: 'cancelling', pendingExecutionId: cancellationOwnerId }
  }

  const [log] = await db
    .select({
      endedAt: workflowExecutionLogs.endedAt,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .where(executionLogScope)
    .limit(1)
  if (!log?.endedAt) return { status: 'not_found' }
  if (
    params.workflowId &&
    (!log.workspaceId || !(await checkWorkspaceAccess(log.workspaceId, params.userId)).hasAccess)
  )
    return { status: 'not_found' }
  return { status: 'finished' }
}

/** A completed owner keeps its queue row until its last descendant retires. */
export async function waitForPendingWorkflowExecutionDrain(
  target: WorkflowCancellationTarget & { workflowId: string },
  result: Exclude<PendingExecutionCancellationResult, { status: 'not_found' }>,
  signal: AbortSignal
) {
  const owners = and(
    workflowOwnerScope(target),
    or(
      eq(pendingExecution.id, target.pendingExecutionId),
      and(
        eq(pendingExecution.source, 'human_in_the_loop'),
        eq(
          sql<string>`${pendingExecution.payload}->>'resumeExecutionId'`,
          target.pendingExecutionId
        )
      )
    )
  )
  const signalled = new Set<string>()
  const recordCancellation = async (outcome: typeof result) => {
    if (!outcome.pendingExecutionId) return
    signalled.add(outcome.pendingExecutionId)
    if (outcome.status === 'finished') {
      // The log may have ended before the authorized owner or its children finished.
      const { cancelPendingExecutionDescendants } = await import(
        '@/background/pending-execution-worker'
      )
      await cancelPendingExecutionDescendants(target.pendingExecutionId)
    }
  }
  signal.throwIfAborted()
  await recordCancellation(result)
  for (;;) {
    signal.throwIfAborted()
    const remaining = await db
      .select({ id: pendingExecution.id })
      .from(pendingExecution)
      .where(owners)
    if (!remaining.length) return
    for (const { id } of remaining) {
      if (signalled.has(id)) continue
      signal.throwIfAborted()
      const outcome = await cancelPendingWorkflowExecution({ ...target, pendingExecutionId: id })
      if (outcome.status === 'not_found')
        throw new Error('Workflow cancellation could not be verified')
      signalled.add(id)
      await recordCancellation(outcome)
    }
    await delay(500, undefined, { signal })
  }
}
