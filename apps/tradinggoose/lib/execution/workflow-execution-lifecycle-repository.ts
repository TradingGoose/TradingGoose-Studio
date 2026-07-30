import { db } from '@tradinggoose/db'
import {
  pendingExecution,
  workflowExecutionAttempt,
  workflowExecutionDeadline,
  workflowExecutionOperation,
  workflowExecutionOutbox,
  workflowExecutionParticipant,
  workflowExecutionTerminal,
} from '@tradinggoose/db/schema'
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import type { ExecutionResult } from '@/executor/types'
import { requireDatabaseDate } from './database-date'
import {
  reconcileWorkflowExecutionDeadline,
  reconcileWorkflowExecutionDeadlineInTransaction,
} from './workflow-execution-deadline-repository'
import {
  createWorkflowDeadlineResult,
  createWorkflowExecutionTimePolicy,
  isWorkflowExecutionTimePolicy,
  secondsToCeilMicroseconds,
  type WorkflowExecutionTimePolicy,
} from './workflow-execution-time-policy'

export type WorkflowExecutionLifecycle = {
  policy: WorkflowExecutionTimePolicy
  attemptId: string
  isRoot: boolean
  participantId?: string
}

type LifecycleTransaction = Pick<typeof db, 'execute' | 'select' | 'insert' | 'update'>

async function selectWorkflowTerminalWinner(
  tx: Pick<typeof db, 'execute'>,
  rootExecutionId: string
): Promise<'deadline' | 'cancellation' | 'infrastructure' | null> {
  const rows = await tx.execute<{ cause: 'deadline' | 'cancellation' | 'infrastructure' }>(sql`
    select candidate.cause
    from ${workflowExecutionTerminal} terminal
    cross join lateral (
      values
        ('deadline'::text, terminal.deadline_candidate_at, 1),
        ('cancellation'::text, terminal.cancellation_candidate_at, 2),
        ('infrastructure'::text, terminal.infrastructure_candidate_at, 3)
    ) candidate(cause, occurred_at, precedence)
    where terminal.root_execution_id = ${rootExecutionId}
      and candidate.occurred_at is not null
    order by candidate.occurred_at asc, candidate.precedence asc
    limit 1
  `)
  return rows[0]?.cause ?? null
}

export async function captureClaimedWorkflowLifecycleInTransaction(params: {
  tx: LifecycleTransaction
  pending: {
    id: string
    billingScopeId: string
    billingScopeType: string
    executionType: string
    source: string
    userId: string
    workflowId: string
    workspaceId: string
    payload: unknown
  }
  processingStartedAt: Date
  drainRunId?: string | null
  tier?: BillingTierRecord | null
}) {
  const payload =
    params.pending.payload &&
    typeof params.pending.payload === 'object' &&
    !Array.isArray(params.pending.payload)
      ? (params.pending.payload as Record<string, unknown>)
      : {}
  const metadata =
    payload.metadata && typeof payload.metadata === 'object' && !Array.isArray(payload.metadata)
      ? (payload.metadata as Record<string, unknown>)
      : {}
  const inherited = isWorkflowExecutionTimePolicy(metadata.workflowExecutionTimePolicy)
    ? metadata.workflowExecutionTimePolicy
    : null
  let rootExecutionId = params.pending.id
  let policy: WorkflowExecutionTimePolicy

  if (inherited) {
    if (params.pending.source !== 'workflow_block') {
      throw new Error('Inherited workflow policy is restricted to workflow-block children')
    }
    rootExecutionId = inherited.rootExecutionId
    await params.tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
    )
    const [root] = await params.tx
      .select()
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
      .limit(1)
    if (
      !root ||
      root.state !== 'running' ||
      !root.dispatchOpen ||
      root.policyState !== inherited.kind ||
      root.appliedTierId !== inherited.appliedTierId ||
      root.processingStartedAt?.toISOString() !== inherited.processingStartedAt ||
      (inherited.kind === 'bounded' && root.limitSeconds !== inherited.limitSeconds)
    ) {
      throw new Error('Inherited workflow execution policy does not match its durable root')
    }
    policy = inherited
    if (policy.kind === 'bounded') {
      const reconciliation = await reconcileWorkflowExecutionDeadlineInTransaction(
        params.tx,
        rootExecutionId
      )
      if (reconciliation.state === 'exhausted') {
        throw new Error('Inherited workflow execution deadline is exhausted')
      }
      const [revalidatedRoot] = await params.tx
        .select({
          state: workflowExecutionTerminal.state,
          dispatchOpen: workflowExecutionTerminal.dispatchOpen,
        })
        .from(workflowExecutionTerminal)
        .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
        .limit(1)
      if (revalidatedRoot?.state !== 'running' || !revalidatedRoot.dispatchOpen) {
        throw new Error('Inherited workflow execution admission is closed')
      }
    }
  } else {
    if (params.pending.source === 'workflow_block') {
      throw new Error('Nested workflow claim is missing its inherited policy')
    }
    if (!params.tier) throw new Error('Workflow execution requires an owning billing tier')
    policy = createWorkflowExecutionTimePolicy({
      rootExecutionId,
      processingStartedAt: params.processingStartedAt.toISOString(),
      tier: params.tier,
    })
    await params.tx.insert(workflowExecutionTerminal).values({
      rootExecutionId,
      workflowId: params.pending.workflowId,
      workspaceId: params.pending.workspaceId,
      actorUserId: params.pending.userId,
      policyState: policy.kind,
      appliedTierId: policy.appliedTierId,
      limitSeconds: policy.kind === 'bounded' ? policy.limitSeconds : null,
      processingStartedAt: params.processingStartedAt,
    })
    if (policy.kind === 'bounded') {
      await params.tx.insert(workflowExecutionDeadline).values({
        rootExecutionId,
        actorUserId: params.pending.userId,
        triggerType: params.pending.executionType,
        appliedTierId: policy.appliedTierId,
        processingStartedAt: params.processingStartedAt,
        limitSeconds: policy.limitSeconds,
        limitMicroseconds: policy.limitMicroseconds,
        lastAccountedAt: params.processingStartedAt,
        nextReconcileAt: params.processingStartedAt,
      })
    }
  }

  const attemptId = uuidv4()
  const [attemptSequence] = await params.tx
    .select({
      next: sql<number>`coalesce(max(${workflowExecutionAttempt.attemptNumber}), 0)::integer + 1`,
    })
    .from(workflowExecutionAttempt)
    .where(eq(workflowExecutionAttempt.pendingExecutionId, params.pending.id))
  await params.tx.insert(workflowExecutionAttempt).values({
    id: attemptId,
    rootExecutionId,
    pendingExecutionId: params.pending.id,
    attemptNumber: attemptSequence?.next ?? 1,
    drainRunId: params.drainRunId,
    processingStartedAt: params.processingStartedAt,
  })
  let participantId: string | undefined
  if (policy.kind === 'bounded') {
    participantId = uuidv4()
    const processingStartedAt = sql.param(
      params.processingStartedAt,
      workflowExecutionParticipant.leaseExpiresAt
    )
    await params.tx.insert(workflowExecutionParticipant).values({
      id: participantId,
      rootExecutionId,
      attemptId,
      pendingExecutionId: params.pending.id,
      state: 'active',
      leaseExpiresAt: sql`${processingStartedAt}::timestamptz + interval '60 seconds'`,
      lastHeartbeatAt: params.processingStartedAt,
    })
    if (!inherited) {
      await params.tx
        .insert(workflowExecutionOutbox)
        .values({
          rootExecutionId,
          kind: 'deadline_reconcile',
          version: 0,
          payload: { rootExecutionId, scheduleVersion: 0 },
          availableAt: params.processingStartedAt,
        })
        .onConflictDoNothing()
    }
  }
  return {
    policy,
    attemptId,
    participantId,
    isRoot: !inherited,
  } satisfies WorkflowExecutionLifecycle
}

export function getWorkflowOperationCapability(
  handlerType: string
): 'local' | 'native_cancel_status' | 'status_only' | 'uncancelable' {
  if (handlerType === 'workflow' || handlerType === 'workflow_input') {
    return 'native_cancel_status'
  }
  if (handlerType === 'gemini_deep_research') return 'status_only'
  if (handlerType === 'tool:browser_use_run_task') return 'uncancelable'
  if (handlerType.startsWith('tool:')) return 'local'
  return 'local'
}

export async function joinWorkflowExecution(params: {
  executionId: string
  policy: WorkflowExecutionTimePolicy
}): Promise<WorkflowExecutionLifecycle> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${params.policy.rootExecutionId}
          for update`
    )
    const [root] = await tx
      .select()
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.policy.rootExecutionId))
      .limit(1)
    if (
      !root ||
      root.state !== 'running' ||
      !root.dispatchOpen ||
      root.policyState !== params.policy.kind ||
      root.appliedTierId !== params.policy.appliedTierId ||
      root.processingStartedAt?.toISOString() !== params.policy.processingStartedAt ||
      (params.policy.kind === 'bounded' && root.limitSeconds !== params.policy.limitSeconds)
    ) {
      throw new Error('Inherited workflow execution policy does not match its durable root')
    }
    const [claimedAttempt] = await tx
      .select({ id: workflowExecutionAttempt.id })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.pendingExecutionId, params.executionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .limit(1)
    if (claimedAttempt) {
      const [participant] = await tx
        .select({ id: workflowExecutionParticipant.id })
        .from(workflowExecutionParticipant)
        .where(eq(workflowExecutionParticipant.attemptId, claimedAttempt.id))
        .limit(1)
      return {
        policy: params.policy,
        attemptId: claimedAttempt.id,
        participantId: participant?.id,
        isRoot: false,
      }
    }
    const attemptId = uuidv4()
    const [attemptSequence] = await tx
      .select({
        next: sql<number>`coalesce(max(${workflowExecutionAttempt.attemptNumber}), 0)::integer + 1`,
      })
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.pendingExecutionId, params.executionId))
    await tx.insert(workflowExecutionAttempt).values({
      id: attemptId,
      rootExecutionId: params.policy.rootExecutionId,
      pendingExecutionId: params.executionId,
      attemptNumber: attemptSequence?.next ?? 1,
      processingStartedAt: sql`clock_timestamp()`,
    })
    let participantId: string | undefined
    if (params.policy.kind === 'bounded') {
      participantId = uuidv4()
      await tx.insert(workflowExecutionParticipant).values({
        id: participantId,
        rootExecutionId: params.policy.rootExecutionId,
        attemptId,
        pendingExecutionId: params.executionId,
        state: 'active',
        leaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
        lastHeartbeatAt: sql`clock_timestamp()`,
      })
    }
    return { policy: params.policy, attemptId, participantId, isRoot: false }
  })
}

export async function captureRootWorkflowExecution(params: {
  executionId: string
  workflowId: string
  workspaceId: string
  actorUserId: string
  triggerType: string
  pendingExecutionId?: string
  drainRunId?: string | null
  tier?: BillingTierRecord
}): Promise<WorkflowExecutionLifecycle> {
  return db.transaction(async (tx) => {
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const processingStartedAt = requireDatabaseDate(
      databaseClock?.now,
      'processing-start timestamp'
    )
    const [existing] = await tx
      .select({ rootExecutionId: workflowExecutionTerminal.rootExecutionId })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.executionId))
      .limit(1)
    if (!existing) {
      if (!params.tier) {
        throw new Error(`Workflow execution ${params.executionId} has no captured policy`)
      }
      const policy = createWorkflowExecutionTimePolicy({
        rootExecutionId: params.executionId,
        processingStartedAt: processingStartedAt.toISOString(),
        tier: params.tier,
      })
      await tx.insert(workflowExecutionTerminal).values({
        rootExecutionId: params.executionId,
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        actorUserId: params.actorUserId,
        policyState: policy.kind,
        appliedTierId: policy.appliedTierId,
        limitSeconds: policy.kind === 'bounded' ? policy.limitSeconds : null,
        processingStartedAt,
      })
    }

    const [stored] = await tx
      .select()
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.executionId))
      .limit(1)
    if (!stored?.processingStartedAt || stored.policyState === 'uncaptured') {
      throw new Error(`Workflow execution ${params.executionId} has no captured policy`)
    }

    if (!stored.appliedTierId) {
      throw new Error(`Workflow execution ${params.executionId} has no captured owning tier`)
    }
    const storedPolicy: WorkflowExecutionTimePolicy =
      stored.policyState === 'bounded'
        ? {
            kind: 'bounded',
            rootExecutionId: params.executionId,
            appliedTierId: stored.appliedTierId,
            processingStartedAt: stored.processingStartedAt.toISOString(),
            limitSeconds: stored.limitSeconds!,
            limitMicroseconds: secondsToCeilMicroseconds(stored.limitSeconds!),
          }
        : {
            kind: 'unlimited',
            rootExecutionId: params.executionId,
            appliedTierId: stored.appliedTierId,
            processingStartedAt: stored.processingStartedAt.toISOString(),
          }
    const pendingExecutionId = params.pendingExecutionId ?? params.executionId
    const [claimedAttempt] = await tx
      .select({ id: workflowExecutionAttempt.id })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.pendingExecutionId, pendingExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .limit(1)
    if (claimedAttempt) {
      const [participant] = await tx
        .select({ id: workflowExecutionParticipant.id })
        .from(workflowExecutionParticipant)
        .where(eq(workflowExecutionParticipant.attemptId, claimedAttempt.id))
        .limit(1)
      return {
        policy: storedPolicy,
        attemptId: claimedAttempt.id,
        participantId: participant?.id,
        isRoot: true,
      }
    }
    const attemptId = uuidv4()
    const [attemptSequence] = await tx
      .select({
        next: sql<number>`coalesce(max(${workflowExecutionAttempt.attemptNumber}), 0)::integer + 1`,
      })
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.pendingExecutionId, pendingExecutionId))
    await tx.insert(workflowExecutionAttempt).values({
      id: attemptId,
      rootExecutionId: params.executionId,
      pendingExecutionId,
      attemptNumber: attemptSequence?.next ?? 1,
      drainRunId: params.drainRunId ?? null,
      processingStartedAt: stored.processingStartedAt,
    })

    if (storedPolicy.kind === 'bounded') {
      await tx
        .insert(workflowExecutionDeadline)
        .values({
          rootExecutionId: params.executionId,
          actorUserId: params.actorUserId,
          triggerType: params.triggerType,
          appliedTierId: storedPolicy.appliedTierId,
          processingStartedAt: stored.processingStartedAt,
          limitSeconds: storedPolicy.limitSeconds,
          limitMicroseconds: storedPolicy.limitMicroseconds,
          lastAccountedAt: stored.processingStartedAt,
          nextReconcileAt: stored.processingStartedAt,
        })
        .onConflictDoNothing()
    }

    let participantId: string | undefined
    if (storedPolicy.kind === 'bounded') {
      participantId = uuidv4()
      await tx.insert(workflowExecutionParticipant).values({
        id: participantId,
        rootExecutionId: params.executionId,
        attemptId,
        pendingExecutionId,
        state: 'active',
        leaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
        lastHeartbeatAt: sql`clock_timestamp()`,
      })
    }

    return { policy: storedPolicy, attemptId, participantId, isRoot: true }
  })
}

export async function completeWorkflowExecutionAttempt(params: {
  attemptId: string
  result: ExecutionResult
}) {
  await db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.id, params.attemptId))
      .limit(1)
    if (!attempt) throw new Error(`Missing workflow attempt ${params.attemptId}`)
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${attempt.rootExecutionId}
          for update`
    )
    await tx
      .update(workflowExecutionParticipant)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(workflowExecutionParticipant.attemptId, params.attemptId))
    await tx
      .update(workflowExecutionAttempt)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        processingCompletedAt: sql`clock_timestamp()`,
      })
      .where(eq(workflowExecutionAttempt.id, params.attemptId))
    await tx
      .insert(workflowExecutionOutbox)
      .values({
        rootExecutionId: attempt.rootExecutionId,
        kind: `child_pending:${attempt.pendingExecutionId}`,
        version: attempt.attemptNumber,
        payload: {
          rootExecutionId: attempt.rootExecutionId,
          pendingExecutionId: attempt.pendingExecutionId,
          attemptId: attempt.id,
          result: params.result,
        },
      })
      .onConflictDoNothing()
  })
}

export async function registerWorkflowOperation(params: {
  rootExecutionId: string
  executionId: string
  attemptId: string
  participantId?: string
  blockId?: string
  handlerType: string
  adapterKind: string
  capability: 'local' | 'native_cancel_status' | 'status_only' | 'uncancelable'
}) {
  const id = uuidv4()
  return db.transaction(async (tx) => {
    const reconciliation = await reconcileWorkflowExecutionDeadlineInTransaction(
      tx,
      params.rootExecutionId
    )
    if (reconciliation.state === 'exhausted') {
      throw new Error('Workflow execution dispatch is closed')
    }
    const [terminal] = await tx
      .select({
        dispatchOpen: workflowExecutionTerminal.dispatchOpen,
        state: workflowExecutionTerminal.state,
      })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
      .limit(1)
    if (!terminal?.dispatchOpen || terminal.state !== 'running') {
      throw new Error('Workflow execution dispatch is closed')
    }
    const [operation] = await tx
      .insert(workflowExecutionOperation)
      .values({ id, ...params, state: 'running' })
      .returning()
    return operation
  })
}

export async function completeWorkflowOperation(params: {
  id: string
  state: 'canceled' | 'completed' | 'failed' | 'local_abort'
  observation?: Record<string, unknown>
}) {
  const [operation] = await db
    .select({
      rootExecutionId: workflowExecutionOperation.rootExecutionId,
      capability: workflowExecutionOperation.capability,
    })
    .from(workflowExecutionOperation)
    .where(eq(workflowExecutionOperation.id, params.id))
    .limit(1)
  if (operation) await reconcileWorkflowExecutionDeadline(operation.rootExecutionId)
  if (params.state === 'local_abort' && operation?.capability !== 'local') {
    await db
      .update(workflowExecutionOperation)
      .set({
        state: 'cancel_requested',
        observation: sql`coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb)
          || ${{
            ...params.observation,
            outcome: 'local_abort_remote_settlement_unknown',
          }}::jsonb`,
        nextReconcileAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowExecutionOperation.id, params.id),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
    return
  }
  await db
    .update(workflowExecutionOperation)
    .set({
      state: params.state === 'local_abort' ? 'canceled' : params.state,
      observation: params.observation,
      terminalAt: sql`clock_timestamp()`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(workflowExecutionOperation.id, params.id),
        inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
      )
    )
}

export async function publishWorkflowOperationIdentity(params: {
  id: string
  adapterKind: string
  capability: 'native_cancel_status' | 'status_only' | 'uncancelable'
  remoteOperationId: string
  observation?: Record<string, unknown>
}) {
  await db
    .update(workflowExecutionOperation)
    .set({
      adapterKind: params.adapterKind,
      capability: params.capability,
      remoteOperationId: params.remoteOperationId,
      observation: params.observation,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(workflowExecutionOperation.id, params.id),
        isNull(workflowExecutionOperation.remoteOperationId),
        inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
      )
    )
}

export async function cancelWorkflowExecutionAtomically(params: {
  pendingExecutionId: string
  actorUserId: string
  descendantOnly?: boolean
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${pendingExecution.id}
          from ${pendingExecution}
          where ${pendingExecution.id} = ${params.pendingExecutionId}
            and ${pendingExecution.userId} = ${params.actorUserId}
            and ${pendingExecution.executionType} = 'workflow'
          for update`
    )
    const [pending] = await tx
      .select()
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.userId, params.actorUserId),
          eq(pendingExecution.executionType, 'workflow')
        )
      )
      .limit(1)
    if (!pending?.workflowId || !pending.workspaceId) return false
    const [attempt] = await tx
      .select({
        rootExecutionId: workflowExecutionAttempt.rootExecutionId,
      })
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.pendingExecutionId, pending.id))
      .limit(1)
    const rootExecutionId = attempt?.rootExecutionId ?? pending.id

    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
    )
    const clockRows = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const requestedAt = requireDatabaseDate(clockRows?.[0]?.now, 'cancellation-request timestamp')
    const payload =
      pending.payload && typeof pending.payload === 'object' && !Array.isArray(pending.payload)
        ? (pending.payload as Record<string, unknown>)
        : {}
    await tx
      .update(pendingExecution)
      .set({
        payload: { ...payload, cancelRequestedAt: requestedAt.toISOString() },
        updatedAt: requestedAt,
      })
      .where(eq(pendingExecution.id, pending.id))
    if (attempt && params.descendantOnly) return true
    await reconcileWorkflowExecutionDeadlineInTransaction(tx, rootExecutionId, {
      terminalCauseAt: requestedAt,
    })

    const processing = pending.status === 'processing' || Boolean(attempt)
    const result: ExecutionResult = {
      success: false,
      output: {},
      error: 'Workflow execution was cancelled',
      code: 'WORKFLOW_EXECUTION_CANCELLED',
    }
    const [inserted] = await tx
      .insert(workflowExecutionTerminal)
      .values({
        rootExecutionId,
        workflowId: pending.workflowId,
        workspaceId: pending.workspaceId,
        actorUserId: params.actorUserId,
        policyState: 'uncaptured',
        state: processing ? 'termination_pending' : 'terminal',
        dispatchOpen: false,
        terminationRequestedAt: requestedAt,
        cancellationCandidateAt: requestedAt,
        winningCause: processing ? null : 'cancellation',
        result: processing ? null : result,
        resultVersion: processing ? 0 : 1,
      })
      .onConflictDoNothing()
      .returning({ resultVersion: workflowExecutionTerminal.resultVersion })
    if (!inserted) {
      const cancellationCandidateAt = sql.param(
        requestedAt,
        workflowExecutionTerminal.cancellationCandidateAt
      )
      await tx
        .update(workflowExecutionTerminal)
        .set({
          state: 'termination_pending',
          dispatchOpen: false,
          barrierVersion: sql`${workflowExecutionTerminal.barrierVersion} + 1`,
          terminationRequestedAt: requestedAt,
          cancellationCandidateAt: sql`coalesce(
            ${workflowExecutionTerminal.cancellationCandidateAt},
            ${cancellationCandidateAt}::timestamptz
          )`,
          updatedAt: requestedAt,
        })
        .where(
          and(
            eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId),
            isNull(workflowExecutionTerminal.result)
          )
        )
    }
    await tx
      .update(workflowExecutionOperation)
      .set({
        state: 'cancel_requested',
        nextReconcileAt: requestedAt,
        updatedAt: requestedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.rootExecutionId, rootExecutionId),
          inArray(workflowExecutionOperation.state, ['registered', 'running'])
        )
      )
    if (processing) {
      const [terminal] = await tx
        .select({ barrierVersion: workflowExecutionTerminal.barrierVersion })
        .from(workflowExecutionTerminal)
        .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
        .limit(1)
      await tx
        .insert(workflowExecutionOutbox)
        .values({
          rootExecutionId,
          kind: 'termination_reconcile',
          version: terminal?.barrierVersion ?? 0,
          payload: { rootExecutionId, barrierVersion: terminal?.barrierVersion ?? 0 },
        })
        .onConflictDoNothing()
    } else {
      for (const kind of ['workflow_log', 'terminal_event', 'pending_execution'] as const) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId,
            kind,
            version: 1,
            payload: { rootExecutionId, resultVersion: 1 },
          })
          .onConflictDoNothing()
      }
    }
    return true
  })
}

export async function finalizeWorkflowExecution(params: {
  rootExecutionId: string
  attemptId: string
  result: ExecutionResult
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${params.rootExecutionId}
          for update`
    )
    // Account through the same database instant while the terminal lock is held.
    // This makes a numerically exhausted deadline ineligible to lose to a late
    // application completion, even when the timer callback has not run yet.
    await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId)
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const completedAt = requireDatabaseDate(databaseClock?.now, 'completion timestamp')
    await tx
      .update(workflowExecutionParticipant)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        updatedAt: completedAt,
      })
      .where(eq(workflowExecutionParticipant.attemptId, params.attemptId))
    await tx
      .update(workflowExecutionAttempt)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        processingCompletedAt: completedAt,
      })
      .where(eq(workflowExecutionAttempt.id, params.attemptId))

    const [activeOperation] = await tx
      .select({ id: workflowExecutionOperation.id })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.rootExecutionId, params.rootExecutionId),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .limit(1)
    const [openAttempt] = await tx
      .select({ id: workflowExecutionAttempt.id })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .limit(1)

    const [terminal] = await tx
      .select()
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
      .limit(1)
    if (!terminal) throw new Error(`Missing workflow terminal ${params.rootExecutionId}`)

    const winner = await selectWorkflowTerminalWinner(tx, params.rootExecutionId)

    if (activeOperation || openAttempt) {
      return terminal.result as ExecutionResult | null
    }

    const storedResult: ExecutionResult =
      winner === 'deadline' &&
      terminal.processingStartedAt &&
      terminal.appliedTierId &&
      terminal.limitSeconds &&
      terminal.deadlineCandidateAt
        ? createWorkflowDeadlineResult({
            policy: {
              kind: 'bounded',
              rootExecutionId: params.rootExecutionId,
              appliedTierId: terminal.appliedTierId,
              processingStartedAt: terminal.processingStartedAt.toISOString(),
              limitSeconds: terminal.limitSeconds,
              limitMicroseconds: secondsToCeilMicroseconds(terminal.limitSeconds),
            },
            terminatedAt: terminal.deadlineCandidateAt.toISOString(),
          })
        : winner === 'cancellation'
          ? {
              success: false,
              output: {},
              error: 'Workflow execution was cancelled',
              code: 'WORKFLOW_EXECUTION_CANCELLED',
            }
          : winner === 'infrastructure'
            ? {
                success: false,
                output: {},
                error: 'Workflow execution infrastructure failed',
                code: 'WORKFLOW_EXECUTION_INFRASTRUCTURE_FAILED',
              }
            : params.result
    if (!storedResult) return null
    const [updated] = await tx
      .update(workflowExecutionTerminal)
      .set({
        state: 'terminal',
        dispatchOpen: false,
        winningCause: winner ?? 'application',
        result: storedResult,
        resultVersion: terminal.resultVersion + 1,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionTerminal.result)
        )
      )
      .returning({
        result: workflowExecutionTerminal.result,
        resultVersion: workflowExecutionTerminal.resultVersion,
      })
    if (updated?.result) {
      for (const kind of ['workflow_log', 'terminal_event', 'pending_execution'] as const) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId: params.rootExecutionId,
            kind,
            version: updated.resultVersion,
            payload: {
              rootExecutionId: params.rootExecutionId,
              resultVersion: updated.resultVersion,
            },
          })
          .onConflictDoNothing()
      }
      const descendants = await tx
        .select({
          id: workflowExecutionAttempt.id,
          pendingExecutionId: workflowExecutionAttempt.pendingExecutionId,
        })
        .from(workflowExecutionAttempt)
        .where(
          and(
            eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId),
            ne(workflowExecutionAttempt.pendingExecutionId, params.rootExecutionId),
            isNull(workflowExecutionAttempt.processingCompletedAt)
          )
        )
      for (const descendant of descendants) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId: params.rootExecutionId,
            kind: `child_pending:${descendant.pendingExecutionId}`,
            version: updated.resultVersion,
            payload: {
              rootExecutionId: params.rootExecutionId,
              pendingExecutionId: descendant.pendingExecutionId,
              attemptId: descendant.id,
              result: updated.result,
            },
          })
          .onConflictDoNothing()
      }
    }
    return (updated?.result ?? terminal.result) as ExecutionResult | null
  })
}

export async function reconcileWorkflowDeadlineTermination(rootExecutionId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
    )
    const [terminal] = await tx
      .select()
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
      .limit(1)
    if (!terminal || terminal.state !== 'termination_pending' || terminal.result) {
      return terminal?.result as ExecutionResult | null
    }

    const [activeOperation] = await tx
      .select({ id: workflowExecutionOperation.id })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.rootExecutionId, rootExecutionId),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .limit(1)
    if (activeOperation) return null

    const [openAttempt] = await tx
      .select({ id: workflowExecutionAttempt.id })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.rootExecutionId, rootExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .limit(1)
    if (openAttempt) return null

    const winner = await selectWorkflowTerminalWinner(tx, rootExecutionId)
    if (!winner) return null
    const result: ExecutionResult =
      winner === 'deadline'
        ? terminal.processingStartedAt &&
          terminal.appliedTierId &&
          terminal.limitSeconds &&
          terminal.deadlineCandidateAt
          ? createWorkflowDeadlineResult({
              policy: {
                kind: 'bounded',
                rootExecutionId,
                appliedTierId: terminal.appliedTierId,
                processingStartedAt: terminal.processingStartedAt.toISOString(),
                limitSeconds: terminal.limitSeconds,
                limitMicroseconds: secondsToCeilMicroseconds(terminal.limitSeconds),
              },
              terminatedAt: terminal.deadlineCandidateAt.toISOString(),
            })
          : (() => {
              throw new Error(`Bounded workflow ${rootExecutionId} has incomplete deadline policy`)
            })()
        : winner === 'cancellation'
          ? {
              success: false,
              output: {},
              error: 'Workflow execution was cancelled',
              code: 'WORKFLOW_EXECUTION_CANCELLED',
            }
          : {
              success: false,
              output: {},
              error: 'Workflow execution infrastructure failed',
              code: 'WORKFLOW_EXECUTION_INFRASTRUCTURE_FAILED',
            }
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const reconciledAt = requireDatabaseDate(
      databaseClock?.now,
      'terminal-reconciliation timestamp'
    )
    const [updated] = await tx
      .update(workflowExecutionTerminal)
      .set({
        state: 'terminal',
        winningCause: winner,
        result,
        resultVersion: terminal.resultVersion + 1,
        updatedAt: reconciledAt,
      })
      .where(
        and(
          eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId),
          isNull(workflowExecutionTerminal.result)
        )
      )
      .returning({
        result: workflowExecutionTerminal.result,
        resultVersion: workflowExecutionTerminal.resultVersion,
      })
    if (updated?.result) {
      for (const kind of ['workflow_log', 'terminal_event', 'pending_execution'] as const) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId,
            kind,
            version: updated.resultVersion,
            payload: { rootExecutionId, resultVersion: updated.resultVersion },
          })
          .onConflictDoNothing()
      }
      const descendants = await tx
        .select({
          id: workflowExecutionAttempt.id,
          pendingExecutionId: workflowExecutionAttempt.pendingExecutionId,
        })
        .from(workflowExecutionAttempt)
        .where(
          and(
            eq(workflowExecutionAttempt.rootExecutionId, rootExecutionId),
            ne(workflowExecutionAttempt.pendingExecutionId, rootExecutionId),
            isNull(workflowExecutionAttempt.processingCompletedAt)
          )
        )
      for (const descendant of descendants) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId,
            kind: `child_pending:${descendant.pendingExecutionId}`,
            version: updated.resultVersion,
            payload: {
              rootExecutionId,
              pendingExecutionId: descendant.pendingExecutionId,
              attemptId: descendant.id,
              result: updated.result,
            },
          })
          .onConflictDoNothing()
      }
    }
    return (updated?.result ?? terminal.result) as ExecutionResult | null
  })
}

export async function listWorkflowExecutionsAwaitingTermination(limit = 100, afterId?: string) {
  return db
    .select({ rootExecutionId: workflowExecutionTerminal.rootExecutionId })
    .from(workflowExecutionTerminal)
    .where(
      afterId
        ? and(
            eq(workflowExecutionTerminal.state, 'termination_pending'),
            gt(workflowExecutionTerminal.rootExecutionId, afterId)
          )
        : eq(workflowExecutionTerminal.state, 'termination_pending')
    )
    .orderBy(asc(workflowExecutionTerminal.rootExecutionId))
    .limit(limit)
}

export async function scheduleWorkflowTerminationReconcile(rootExecutionId: string) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
    )
    const [terminal] = await tx
      .update(workflowExecutionTerminal)
      .set({
        barrierVersion: sql`${workflowExecutionTerminal.barrierVersion} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId),
          eq(workflowExecutionTerminal.state, 'termination_pending'),
          isNull(workflowExecutionTerminal.result)
        )
      )
      .returning({ barrierVersion: workflowExecutionTerminal.barrierVersion })
    if (!terminal) return
    await tx
      .insert(workflowExecutionOutbox)
      .values({
        rootExecutionId,
        kind: 'termination_reconcile',
        version: terminal.barrierVersion,
        payload: { rootExecutionId, barrierVersion: terminal.barrierVersion },
        availableAt: sql`clock_timestamp() + interval '10 seconds'`,
      })
      .onConflictDoNothing()
  })
}

export async function claimWorkflowOperationsForTermination(rootExecutionId: string, limit = 100) {
  const rows = await db.execute<{
    id: string
    capability: 'local' | 'native_cancel_status' | 'status_only' | 'uncancelable'
    adapter_kind: string
    remote_operation_id: string | null
    observation: Record<string, unknown> | null
    fencing_token: string
  }>(sql`
    with candidates as (
      select ${workflowExecutionOperation.id}
      from ${workflowExecutionOperation}
      where ${workflowExecutionOperation.rootExecutionId} = ${rootExecutionId}
        and ${workflowExecutionOperation.state} = 'cancel_requested'
        and (
          ${workflowExecutionOperation.nextReconcileAt} is null
          or ${workflowExecutionOperation.nextReconcileAt} <= clock_timestamp()
        )
        and (
          ${workflowExecutionOperation.leaseExpiresAt} is null
          or ${workflowExecutionOperation.leaseExpiresAt} < clock_timestamp()
        )
      order by ${workflowExecutionOperation.createdAt}, ${workflowExecutionOperation.id}
      for update skip locked
      limit ${limit}
    )
    update ${workflowExecutionOperation} operation
    set fencing_token = gen_random_uuid()::text,
        lease_expires_at = clock_timestamp() + interval '60 seconds',
        last_observed_at = clock_timestamp()
    from candidates
    where operation.id = candidates.id
    returning operation.id, operation.capability, operation.adapter_kind,
              operation.remote_operation_id, operation.observation, operation.fencing_token
  `)
  return rows.map((row) => ({
    id: row.id,
    capability: row.capability,
    adapterKind: row.adapter_kind,
    remoteOperationId: row.remote_operation_id,
    observation: row.observation,
    fencingToken: row.fencing_token,
  }))
}

export async function recordWorkflowOperationObservation(params: {
  id: string
  fencingToken: string
  state?: 'canceled' | 'completed' | 'failed'
  observation?: Record<string, unknown>
}) {
  await db
    .update(workflowExecutionOperation)
    .set(
      params.state
        ? {
            state: params.state,
            observation: params.observation,
            terminalAt: sql`clock_timestamp()`,
            leaseExpiresAt: null,
            nextReconcileAt: null,
            updatedAt: sql`clock_timestamp()`,
          }
        : {
            observation: params.observation,
            leaseExpiresAt: null,
            nextReconcileAt: sql`clock_timestamp() + interval '10 seconds'`,
            updatedAt: sql`clock_timestamp()`,
          }
    )
    .where(
      and(
        eq(workflowExecutionOperation.id, params.id),
        eq(workflowExecutionOperation.fencingToken, params.fencingToken),
        eq(workflowExecutionOperation.state, 'cancel_requested')
      )
    )
}

export async function listOpenWorkflowExecutionAttempts(limit = 100, afterId?: string) {
  return db
    .select({
      id: workflowExecutionAttempt.id,
      rootExecutionId: workflowExecutionAttempt.rootExecutionId,
      drainRunId: workflowExecutionAttempt.drainRunId,
    })
    .from(workflowExecutionAttempt)
    .where(
      afterId
        ? and(
            isNull(workflowExecutionAttempt.processingCompletedAt),
            gt(workflowExecutionAttempt.id, afterId)
          )
        : isNull(workflowExecutionAttempt.processingCompletedAt)
    )
    .orderBy(asc(workflowExecutionAttempt.id))
    .limit(limit)
}

export async function listOpenWorkflowExecutionAttemptsForRoot(rootExecutionId: string) {
  return db
    .select({
      id: workflowExecutionAttempt.id,
      rootExecutionId: workflowExecutionAttempt.rootExecutionId,
      drainRunId: workflowExecutionAttempt.drainRunId,
    })
    .from(workflowExecutionAttempt)
    .where(
      and(
        eq(workflowExecutionAttempt.rootExecutionId, rootExecutionId),
        isNull(workflowExecutionAttempt.processingCompletedAt)
      )
    )
    .orderBy(asc(workflowExecutionAttempt.id))
}

export async function recordWorkflowAttemptTerminalObservation(params: {
  attemptId: string
  rootExecutionId: string
  state: 'completed' | 'canceled' | 'failed'
  finishedAt: Date
}) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${params.rootExecutionId}
          for update`
    )
    const [attempt] = await tx
      .select({ id: workflowExecutionAttempt.id })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId)
        )
      )
      .limit(1)
    if (!attempt) return
    const attemptState = params.state
    const [closed] = await tx
      .update(workflowExecutionAttempt)
      .set({
        state: attemptState,
        processingCompletedAt: params.finishedAt,
      })
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .returning({ id: workflowExecutionAttempt.id })
    if (closed) {
      await tx
        .update(workflowExecutionParticipant)
        .set({ state: attemptState, updatedAt: params.finishedAt })
        .where(eq(workflowExecutionParticipant.attemptId, params.attemptId))
    }
    const settledOperations = await tx
      .update(workflowExecutionOperation)
      .set({
        state: attemptState,
        terminalAt: params.finishedAt,
        updatedAt: params.finishedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.attemptId, params.attemptId),
          eq(workflowExecutionOperation.capability, 'local'),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    if (!closed && settledOperations.length === 0) return
    await tx
      .update(workflowExecutionTerminal)
      .set({
        barrierVersion: sql`${workflowExecutionTerminal.barrierVersion} + 1`,
        updatedAt: params.finishedAt,
      })
      .where(
        and(
          eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionTerminal.result)
        )
      )
  })
}

export async function recordWorkflowInfrastructureCandidate(params: {
  attemptId: string
  rootExecutionId: string
  failedAt: Date
  diagnostics?: Record<string, unknown>
}) {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${params.rootExecutionId}
          for update`
    )
    await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId, {
      terminalCauseAt: params.failedAt,
    })
    const infrastructureCandidateAt = sql.param(
      params.failedAt,
      workflowExecutionTerminal.infrastructureCandidateAt
    )
    const failedAt = sql`${infrastructureCandidateAt}::timestamptz`
    await tx
      .update(workflowExecutionTerminal)
      .set({
        state: 'termination_pending',
        dispatchOpen: false,
        infrastructureCandidateAt: sql`
          case
            when ${workflowExecutionTerminal.infrastructureCandidateAt} is null
              or ${failedAt} < ${workflowExecutionTerminal.infrastructureCandidateAt}
            then ${failedAt}
            else ${workflowExecutionTerminal.infrastructureCandidateAt}
          end
        `,
        infrastructureDiagnostics: sql`
          case
            when ${workflowExecutionTerminal.infrastructureCandidateAt} is null
              or ${failedAt} < ${workflowExecutionTerminal.infrastructureCandidateAt}
            then ${params.diagnostics ?? null}
            else ${workflowExecutionTerminal.infrastructureDiagnostics}
          end
        `,
        barrierVersion: sql`${workflowExecutionTerminal.barrierVersion} + 1`,
        updatedAt: params.failedAt,
      })
      .where(
        and(
          eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionTerminal.result)
        )
      )
    await tx
      .update(workflowExecutionOperation)
      .set({ state: 'cancel_requested', updatedAt: params.failedAt })
      .where(
        and(
          eq(workflowExecutionOperation.rootExecutionId, params.rootExecutionId),
          inArray(workflowExecutionOperation.state, ['registered', 'running'])
        )
      )
    const [terminal] = await tx
      .select({ barrierVersion: workflowExecutionTerminal.barrierVersion })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
      .limit(1)
    await tx
      .insert(workflowExecutionOutbox)
      .values({
        rootExecutionId: params.rootExecutionId,
        kind: 'termination_reconcile',
        version: terminal?.barrierVersion ?? 0,
        payload: {
          rootExecutionId: params.rootExecutionId,
          barrierVersion: terminal?.barrierVersion ?? 0,
        },
      })
      .onConflictDoNothing()
  })
}

export async function getWorkflowExecutionProjection(rootExecutionId: string) {
  const [terminal] = await db
    .select()
    .from(workflowExecutionTerminal)
    .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
    .limit(1)
  return terminal ?? null
}
