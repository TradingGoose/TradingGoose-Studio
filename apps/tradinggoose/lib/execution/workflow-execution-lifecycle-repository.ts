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
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import type { ExecutionResult } from '@/executor/types'
import { requireDatabaseDate } from './database-date'
import {
  reconcileWorkflowExecutionDeadlineInTransaction,
  transitionWorkflowExecutionParticipantInTransaction,
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
  startupOperationId: string
  isRoot: boolean
  participantId?: string
}

export type WorkflowExecutionOperationHandle = {
  id: string
  rootExecutionId: string
  attemptId: string
  participantId?: string
}

export type WorkflowExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelling' }
  | { status: 'finished' }

type LifecycleTransaction = Pick<typeof db, 'execute' | 'select' | 'insert' | 'update'>

async function isWorkflowExecutionAttemptOpen(
  tx: LifecycleTransaction,
  rootExecutionId: string,
  attemptId: string
) {
  const [attempt] = await tx
    .select({ id: workflowExecutionAttempt.id })
    .from(workflowExecutionAttempt)
    .where(
      and(
        eq(workflowExecutionAttempt.id, attemptId),
        eq(workflowExecutionAttempt.rootExecutionId, rootExecutionId),
        isNull(workflowExecutionAttempt.processingCompletedAt)
      )
    )
    .limit(1)
  return Boolean(attempt)
}

async function createWorkflowStartupOperation(
  tx: LifecycleTransaction,
  params: {
    rootExecutionId: string
    executionId: string
    attemptId: string
    participantId?: string
  }
) {
  const id = uuidv4()
  await tx.insert(workflowExecutionOperation).values({
    id,
    ...params,
    handlerType: 'workflow_startup',
    adapterKind: 'workflow_startup',
    capability: 'local',
    state: 'running',
  })
  return id
}

function terminalWorkflowOperationObservation(incoming?: Record<string, unknown>) {
  const observation = sql.param(incoming ?? {}, workflowExecutionOperation.observation)
  return sql`(
    coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb)
    || ${observation}::jsonb
  ) - '_credentialLease'`
}

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
    const parentOperationId =
      typeof metadata.parentOperationId === 'string' ? metadata.parentOperationId : null
    if (!parentOperationId) throw new Error('Nested workflow claim is missing its parent operation')
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
      root.appliedTierName !== inherited.appliedTierName ||
      root.processingStartedAt?.toISOString() !== inherited.processingStartedAt ||
      (inherited.kind === 'bounded' && root.limitSeconds !== inherited.limitSeconds)
    ) {
      throw new Error('Inherited workflow execution policy does not match its durable root')
    }
    policy = inherited
    if (policy.kind === 'bounded') {
      const [parentLocator] = await params.tx
        .select({
          attemptId: workflowExecutionOperation.attemptId,
          participantId: workflowExecutionOperation.participantId,
          remoteOperationId: workflowExecutionOperation.remoteOperationId,
          rootExecutionId: workflowExecutionOperation.rootExecutionId,
          state: workflowExecutionOperation.state,
        })
        .from(workflowExecutionOperation)
        .where(eq(workflowExecutionOperation.id, parentOperationId))
        .limit(1)
      if (
        !parentLocator?.participantId ||
        parentLocator.rootExecutionId !== rootExecutionId ||
        parentLocator.remoteOperationId !== params.pending.id ||
        !['registered', 'running'].includes(parentLocator.state)
      ) {
        throw new Error('Inherited workflow execution admission is closed')
      }
      const reconciliation = await transitionWorkflowExecutionParticipantInTransaction(params.tx, {
        rootExecutionId,
        attemptId: parentLocator.attemptId,
        participantId: parentLocator.participantId,
      })
      if (!reconciliation || reconciliation.state === 'exhausted') {
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
      if (
        !(await isWorkflowExecutionAttemptOpen(params.tx, rootExecutionId, parentLocator.attemptId))
      ) {
        throw new Error('Inherited workflow execution admission is closed')
      }
    }
    const [parentOperation] = await params.tx
      .select({
        attemptId: workflowExecutionOperation.attemptId,
        participantId: workflowExecutionOperation.participantId,
        remoteOperationId: workflowExecutionOperation.remoteOperationId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(eq(workflowExecutionOperation.id, parentOperationId))
      .limit(1)
    if (
      !parentOperation ||
      parentOperation.rootExecutionId !== rootExecutionId ||
      parentOperation.remoteOperationId !== params.pending.id ||
      (policy.kind === 'unlimited' && parentOperation.participantId) ||
      !['registered', 'running'].includes(parentOperation.state)
    ) {
      throw new Error('Inherited workflow execution admission is closed')
    }
    if (
      !(await isWorkflowExecutionAttemptOpen(params.tx, rootExecutionId, parentOperation.attemptId))
    ) {
      throw new Error('Inherited workflow execution admission is closed')
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
      appliedTierName: policy.appliedTierName,
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
  const startupOperationId = await createWorkflowStartupOperation(params.tx, {
    rootExecutionId,
    executionId: params.pending.id,
    attemptId,
    participantId,
  })
  return {
    policy,
    attemptId,
    participantId,
    startupOperationId,
    isRoot: !inherited,
  } satisfies WorkflowExecutionLifecycle
}

export function getWorkflowOperationCapability(
  handlerType: string
): 'local' | 'native_cancel_status' | 'status_only' | 'uncancelable' {
  if (handlerType === 'workflow' || handlerType === 'workflow_input') {
    return 'native_cancel_status'
  }
  if (
    handlerType === 'agent' ||
    handlerType === 'agent_tool' ||
    handlerType === 'api' ||
    handlerType === 'function' ||
    handlerType.startsWith('tool:') ||
    handlerType === 'wait' ||
    handlerType === 'condition' ||
    handlerType === 'loop' ||
    handlerType === 'parallel' ||
    handlerType === 'response' ||
    handlerType === 'variables'
  ) {
    return 'local'
  }
  return 'uncancelable'
}

export async function completeWorkflowExecutionAttempt(params: {
  attemptId: string
  result: ExecutionResult
}) {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.id, params.attemptId))
      .limit(1)
    if (!attempt) throw new Error(`Missing workflow attempt ${params.attemptId}`)
    if (attempt.processingCompletedAt) return
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const completedAt = requireDatabaseDate(databaseClock?.now, 'completion timestamp')
    const [participant] = await tx
      .select({ id: workflowExecutionParticipant.id })
      .from(workflowExecutionParticipant)
      .where(
        and(
          eq(workflowExecutionParticipant.rootExecutionId, attempt.rootExecutionId),
          eq(workflowExecutionParticipant.attemptId, params.attemptId)
        )
      )
      .limit(1)
    const evidence = participant
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: attempt.rootExecutionId,
          attemptId: params.attemptId,
          participantId: participant.id,
          state: params.result.success ? 'completed' : 'failed',
          observedAt: completedAt,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, attempt.rootExecutionId, {
          terminalCauseAt: completedAt,
          allowTerminalObservation: true,
        })
    if (
      !evidence ||
      evidence.state === 'closed' ||
      (!participant && evidence.state !== 'unlimited')
    ) {
      return
    }
    if (!(await isWorkflowExecutionAttemptOpen(tx, attempt.rootExecutionId, params.attemptId)))
      return
    const [closedAttempt] = await tx
      .update(workflowExecutionAttempt)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        processingCompletedAt: completedAt,
      })
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, attempt.rootExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .returning({ id: workflowExecutionAttempt.id })
    if (!closedAttempt) throw new Error('Workflow execution attempt ownership was lost')
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
    const [attempt] = await tx
      .select({ processingCompletedAt: workflowExecutionAttempt.processingCompletedAt })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId)
        )
      )
      .limit(1)
    if (!attempt || attempt.processingCompletedAt) {
      throw new Error('Workflow execution dispatch is closed')
    }
    const reconciliation = params.participantId
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: params.rootExecutionId,
          attemptId: params.attemptId,
          participantId: params.participantId,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId)
    if (
      !reconciliation ||
      reconciliation.state === 'exhausted' ||
      (!params.participantId && reconciliation.state !== 'unlimited')
    ) {
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
    if (!(await isWorkflowExecutionAttemptOpen(tx, params.rootExecutionId, params.attemptId))) {
      throw new Error('Workflow execution dispatch is closed')
    }
    if (params.participantId) {
      const [participant] = await tx
        .select({ id: workflowExecutionParticipant.id })
        .from(workflowExecutionParticipant)
        .where(
          and(
            eq(workflowExecutionParticipant.id, params.participantId),
            eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
            eq(workflowExecutionParticipant.attemptId, params.attemptId),
            inArray(workflowExecutionParticipant.state, ['active', 'waiting_child'])
          )
        )
        .limit(1)
      if (!participant) throw new Error('Workflow execution dispatch is closed')
    }
    const [operation] = await tx
      .insert(workflowExecutionOperation)
      .values({ id, ...params, state: 'running' })
      .returning()
    if (!operation) throw new Error('Workflow execution dispatch is closed')
    return operation
  })
}

export async function admitNestedWorkflowExecutionInTransaction(
  tx: LifecycleTransaction,
  params: {
    operationId: string
    pendingExecutionId: string
    policy: WorkflowExecutionTimePolicy
  }
) {
  const [locator] = await tx
    .select({
      participantId: workflowExecutionOperation.participantId,
      remoteOperationId: workflowExecutionOperation.remoteOperationId,
      rootExecutionId: workflowExecutionOperation.rootExecutionId,
      state: workflowExecutionOperation.state,
      attemptId: workflowExecutionOperation.attemptId,
    })
    .from(workflowExecutionOperation)
    .where(eq(workflowExecutionOperation.id, params.operationId))
    .limit(1)
  if (
    !locator ||
    locator.rootExecutionId !== params.policy.rootExecutionId ||
    !['registered', 'running'].includes(locator.state) ||
    (locator.remoteOperationId && locator.remoteOperationId !== params.pendingExecutionId)
  ) {
    throw new Error('Nested workflow admission is closed')
  }
  if (params.policy.kind === 'bounded' && !locator.participantId) {
    throw new Error('Nested workflow admission is closed')
  }
  if (
    !(await isWorkflowExecutionAttemptOpen(tx, params.policy.rootExecutionId, locator.attemptId))
  ) {
    throw new Error('Nested workflow admission is closed')
  }
  const reconciliation = locator.participantId
    ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
        rootExecutionId: params.policy.rootExecutionId,
        attemptId: locator.attemptId,
        participantId: locator.participantId,
      })
    : await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.policy.rootExecutionId)
  if (
    !reconciliation ||
    reconciliation.state === 'exhausted' ||
    reconciliation.state === 'closed'
  ) {
    throw new Error('Nested workflow admission is closed')
  }
  if (
    !(await isWorkflowExecutionAttemptOpen(tx, params.policy.rootExecutionId, locator.attemptId))
  ) {
    throw new Error('Nested workflow admission is closed')
  }
  const [root] = await tx
    .select()
    .from(workflowExecutionTerminal)
    .where(eq(workflowExecutionTerminal.rootExecutionId, params.policy.rootExecutionId))
    .limit(1)
  const [operation] = await tx
    .select()
    .from(workflowExecutionOperation)
    .where(eq(workflowExecutionOperation.id, params.operationId))
    .limit(1)
  if (
    !root ||
    root.state !== 'running' ||
    !root.dispatchOpen ||
    root.policyState !== params.policy.kind ||
    root.appliedTierId !== params.policy.appliedTierId ||
    root.appliedTierName !== params.policy.appliedTierName ||
    root.processingStartedAt?.toISOString() !== params.policy.processingStartedAt ||
    (params.policy.kind === 'bounded' && root.limitSeconds !== params.policy.limitSeconds) ||
    !operation ||
    operation.rootExecutionId !== params.policy.rootExecutionId ||
    operation.attemptId !== locator.attemptId ||
    operation.participantId !== locator.participantId ||
    !['registered', 'running'].includes(operation.state) ||
    (operation.remoteOperationId && operation.remoteOperationId !== params.pendingExecutionId)
  ) {
    throw new Error('Nested workflow admission is closed')
  }
  const [boundOperation] = await tx
    .update(workflowExecutionOperation)
    .set({
      adapterKind: 'workflow',
      capability: 'native_cancel_status',
      remoteOperationId: params.pendingExecutionId,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(workflowExecutionOperation.id, params.operationId),
        eq(workflowExecutionOperation.rootExecutionId, params.policy.rootExecutionId),
        eq(workflowExecutionOperation.attemptId, locator.attemptId),
        locator.participantId
          ? eq(workflowExecutionOperation.participantId, locator.participantId)
          : isNull(workflowExecutionOperation.participantId),
        inArray(workflowExecutionOperation.state, ['registered', 'running']),
        sql`(${workflowExecutionOperation.remoteOperationId} is null
          or ${workflowExecutionOperation.remoteOperationId} = ${params.pendingExecutionId})`
      )
    )
    .returning({ id: workflowExecutionOperation.id })
  if (!boundOperation) throw new Error('Nested workflow admission is closed')
}

export async function completeWorkflowOperation(params: {
  operation: WorkflowExecutionOperationHandle
  state: 'canceled' | 'completed' | 'failed' | 'local_abort'
  observation?: Record<string, unknown>
}) {
  return db.transaction(async (tx) => {
    const [locator] = await tx
      .select({
        attemptId: workflowExecutionOperation.attemptId,
        participantId: workflowExecutionOperation.participantId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, params.operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, params.operation.attemptId),
          params.operation.participantId
            ? eq(workflowExecutionOperation.participantId, params.operation.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (!locator || !['registered', 'running', 'cancel_requested'].includes(locator.state)) return
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const completedAt = requireDatabaseDate(databaseClock?.now, 'operation completion timestamp')
    let evidence
    if (locator.participantId) {
      evidence = await transitionWorkflowExecutionParticipantInTransaction(tx, {
        rootExecutionId: locator.rootExecutionId,
        attemptId: locator.attemptId,
        participantId: locator.participantId,
        observedAt: completedAt,
      })
    } else {
      evidence = await reconcileWorkflowExecutionDeadlineInTransaction(
        tx,
        locator.rootExecutionId,
        {
          terminalCauseAt: completedAt,
          allowTerminalObservation: true,
        }
      )
    }
    if (
      !evidence ||
      evidence.state === 'closed' ||
      (!locator.participantId && evidence.state !== 'unlimited')
    ) {
      return
    }
    const [operation] = await tx
      .select({ capability: workflowExecutionOperation.capability })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, params.operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, params.operation.attemptId),
          params.operation.participantId
            ? eq(workflowExecutionOperation.participantId, params.operation.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (!operation) return
    if (params.state === 'local_abort' && operation.capability !== 'local') {
      const observation = sql.param(
        {
          ...params.observation,
          outcome: 'local_abort_remote_settlement_unknown',
        },
        workflowExecutionOperation.observation
      )
      const [requested] = await tx
        .update(workflowExecutionOperation)
        .set({
          state: 'cancel_requested',
          observation: sql`coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb)
            || ${observation}::jsonb`,
          nextReconcileAt: completedAt,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(workflowExecutionOperation.id, params.operation.id),
            eq(workflowExecutionOperation.rootExecutionId, locator.rootExecutionId),
            eq(workflowExecutionOperation.attemptId, locator.attemptId),
            locator.participantId
              ? eq(workflowExecutionOperation.participantId, locator.participantId)
              : isNull(workflowExecutionOperation.participantId),
            inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
          )
        )
        .returning({ id: workflowExecutionOperation.id })
      if (!requested) throw new Error('Workflow operation ownership was lost')
      return true
    }
    const [completed] = await tx
      .update(workflowExecutionOperation)
      .set({
        state: params.state === 'local_abort' ? 'canceled' : params.state,
        observation: terminalWorkflowOperationObservation(params.observation),
        terminalAt: completedAt,
        updatedAt: completedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, locator.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, locator.attemptId),
          locator.participantId
            ? eq(workflowExecutionOperation.participantId, locator.participantId)
            : isNull(workflowExecutionOperation.participantId),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    if (!completed) throw new Error('Workflow operation ownership was lost')
    return true
  })
}

export async function publishWorkflowOperationIdentity(params: {
  operation: WorkflowExecutionOperationHandle
  adapterKind: string
  capability: 'native_cancel_status' | 'status_only' | 'uncancelable'
  remoteOperationId: string
  observation?: Record<string, unknown>
  expectedAdapterKind?: string
  expectedRemoteOperationId?: string
}) {
  return db.transaction(async (tx) => {
    const [operation] = await tx
      .select({
        adapterKind: workflowExecutionOperation.adapterKind,
        attemptId: workflowExecutionOperation.attemptId,
        participantId: workflowExecutionOperation.participantId,
        remoteOperationId: workflowExecutionOperation.remoteOperationId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, params.operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, params.operation.attemptId),
          params.operation.participantId
            ? eq(workflowExecutionOperation.participantId, params.operation.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (
      !operation ||
      !['registered', 'running', 'cancel_requested'].includes(operation.state) ||
      (params.expectedAdapterKind && operation.adapterKind !== params.expectedAdapterKind) ||
      (params.expectedRemoteOperationId &&
        operation.remoteOperationId !== params.expectedRemoteOperationId) ||
      (!params.expectedRemoteOperationId && operation.remoteOperationId)
    ) {
      return
    }
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const observedAt = requireDatabaseDate(databaseClock?.now, 'operation identity timestamp')
    const observation = params.observation
      ? sql.param(params.observation, workflowExecutionOperation.observation)
      : null
    if (operation?.participantId) {
      const evidence = await transitionWorkflowExecutionParticipantInTransaction(tx, {
        rootExecutionId: operation.rootExecutionId,
        attemptId: operation.attemptId,
        participantId: operation.participantId,
        observedAt,
      })
      if (!evidence || evidence.state === 'closed') return
    } else if (operation) {
      const evidence = await reconcileWorkflowExecutionDeadlineInTransaction(
        tx,
        operation.rootExecutionId,
        { allowTerminalObservation: true }
      )
      if (evidence.state !== 'unlimited') return
    }
    const [published] = await tx
      .update(workflowExecutionOperation)
      .set({
        adapterKind: params.adapterKind,
        capability: params.capability,
        remoteOperationId: params.remoteOperationId,
        observation: observation
          ? sql`coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb) || ${observation}::jsonb`
          : workflowExecutionOperation.observation,
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, operation.attemptId),
          operation.participantId
            ? eq(workflowExecutionOperation.participantId, operation.participantId)
            : isNull(workflowExecutionOperation.participantId),
          params.expectedAdapterKind && params.expectedRemoteOperationId
            ? and(
                eq(workflowExecutionOperation.adapterKind, params.expectedAdapterKind),
                eq(workflowExecutionOperation.remoteOperationId, params.expectedRemoteOperationId)
              )
            : isNull(workflowExecutionOperation.remoteOperationId),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    if (!published) throw new Error('Workflow operation ownership was lost')
    return true
  })
}

export async function sealWorkflowOperationCredential(
  operationHandle: WorkflowExecutionOperationHandle,
  encrypted: string
) {
  return db.transaction(async (tx) => {
    const [operation] = await tx
      .select({
        attemptId: workflowExecutionOperation.attemptId,
        participantId: workflowExecutionOperation.participantId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, operationHandle.id),
          eq(workflowExecutionOperation.rootExecutionId, operationHandle.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, operationHandle.attemptId),
          operationHandle.participantId
            ? eq(workflowExecutionOperation.participantId, operationHandle.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (!operation || !['registered', 'running'].includes(operation.state)) return
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const observedAt = requireDatabaseDate(databaseClock?.now, 'operation credential timestamp')
    const credential = sql.param(
      { _credentialLease: encrypted },
      workflowExecutionOperation.observation
    )
    if (operation?.participantId) {
      const evidence = await transitionWorkflowExecutionParticipantInTransaction(tx, {
        rootExecutionId: operation.rootExecutionId,
        attemptId: operation.attemptId,
        participantId: operation.participantId,
        observedAt,
      })
      if (!evidence || evidence.state === 'closed') return
    } else if (operation) {
      const evidence = await reconcileWorkflowExecutionDeadlineInTransaction(
        tx,
        operation.rootExecutionId,
        { allowTerminalObservation: true }
      )
      if (evidence.state !== 'unlimited') return
    }
    const [sealed] = await tx
      .update(workflowExecutionOperation)
      .set({
        observation: sql`coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb)
          || ${credential}::jsonb`,
        updatedAt: observedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.id, operationHandle.id),
          eq(workflowExecutionOperation.rootExecutionId, operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, operation.attemptId),
          operation.participantId
            ? eq(workflowExecutionOperation.participantId, operation.participantId)
            : isNull(workflowExecutionOperation.participantId),
          inArray(workflowExecutionOperation.state, ['registered', 'running'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    if (!sealed) throw new Error('Workflow operation ownership was lost')
    return true
  })
}

export async function claimWorkflowOperationRemoteDispatch(
  operationHandle: WorkflowExecutionOperationHandle
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [registered] = await tx
      .select({
        attemptId: workflowExecutionOperation.attemptId,
        participantId: workflowExecutionOperation.participantId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, operationHandle.id),
          eq(workflowExecutionOperation.rootExecutionId, operationHandle.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, operationHandle.attemptId),
          operationHandle.participantId
            ? eq(workflowExecutionOperation.participantId, operationHandle.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (!registered || !['registered', 'running'].includes(registered.state)) return false
    const reconciliation = registered.participantId
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: registered.rootExecutionId,
          attemptId: registered.attemptId,
          participantId: registered.participantId,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, registered.rootExecutionId)
    if (
      !reconciliation ||
      reconciliation.state === 'exhausted' ||
      reconciliation.state === 'closed' ||
      (!registered.participantId && reconciliation.state !== 'unlimited')
    ) {
      return false
    }
    if (
      !(await isWorkflowExecutionAttemptOpen(tx, registered.rootExecutionId, registered.attemptId))
    ) {
      return false
    }
    const [terminal] = await tx
      .select({
        dispatchOpen: workflowExecutionTerminal.dispatchOpen,
        state: workflowExecutionTerminal.state,
      })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, registered.rootExecutionId))
      .limit(1)
    if (!terminal?.dispatchOpen || terminal.state !== 'running') return false
    const [operation] = await tx
      .update(workflowExecutionOperation)
      .set({
        adapterKind: sql`case when ${workflowExecutionOperation.capability} = 'local' then 'tool' else ${workflowExecutionOperation.adapterKind} end`,
        capability: sql`case when ${workflowExecutionOperation.capability} = 'local' then 'uncancelable' else ${workflowExecutionOperation.capability} end`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowExecutionOperation.id, operationHandle.id),
          eq(workflowExecutionOperation.rootExecutionId, registered.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, registered.attemptId),
          registered.participantId
            ? eq(workflowExecutionOperation.participantId, registered.participantId)
            : isNull(workflowExecutionOperation.participantId),
          inArray(workflowExecutionOperation.state, ['registered', 'running'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    return operation !== undefined
  })
}

export async function cancelWorkflowExecutionAtomically(params: {
  pendingExecutionId: string
  actorUserId: string
  descendantOnly?: boolean
}): Promise<WorkflowExecutionCancellationResult> {
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
    if (!pending?.workflowId || !pending.workspaceId) {
      const [directTerminal] = await tx
        .select({ state: workflowExecutionTerminal.state })
        .from(workflowExecutionTerminal)
        .where(
          and(
            eq(workflowExecutionTerminal.rootExecutionId, params.pendingExecutionId),
            eq(workflowExecutionTerminal.actorUserId, params.actorUserId)
          )
        )
        .limit(1)
      if (directTerminal) {
        return { status: directTerminal.state === 'terminal' ? 'finished' : 'cancelling' }
      }
      const [settledAttempt] = await tx
        .select({
          processingCompletedAt: workflowExecutionAttempt.processingCompletedAt,
          rootExecutionId: workflowExecutionAttempt.rootExecutionId,
        })
        .from(workflowExecutionAttempt)
        .where(eq(workflowExecutionAttempt.pendingExecutionId, params.pendingExecutionId))
        .orderBy(desc(workflowExecutionAttempt.attemptNumber))
        .limit(1)
      if (!settledAttempt) return { status: 'not_found' }
      const [attemptRoot] = await tx
        .select({ actorUserId: workflowExecutionTerminal.actorUserId })
        .from(workflowExecutionTerminal)
        .where(eq(workflowExecutionTerminal.rootExecutionId, settledAttempt.rootExecutionId))
        .limit(1)
      if (attemptRoot?.actorUserId !== params.actorUserId) return { status: 'not_found' }
      return {
        status: settledAttempt.processingCompletedAt ? 'finished' : 'cancelling',
      }
    }
    const [attempt] = await tx
      .select({
        processingCompletedAt: workflowExecutionAttempt.processingCompletedAt,
        rootExecutionId: workflowExecutionAttempt.rootExecutionId,
      })
      .from(workflowExecutionAttempt)
      .where(eq(workflowExecutionAttempt.pendingExecutionId, pending.id))
      .orderBy(desc(workflowExecutionAttempt.attemptNumber))
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
    if (attempt && params.descendantOnly) {
      return { status: attempt.processingCompletedAt ? 'finished' : 'cancelling' }
    }
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
    return { status: processing ? 'cancelling' : 'finished' }
  })
}

export async function finalizeWorkflowExecution(params: {
  rootExecutionId: string
  attemptId: string
  result: ExecutionResult
}) {
  return db.transaction(async (tx) => {
    const [terminalSnapshot] = await tx
      .select({ result: workflowExecutionTerminal.result })
      .from(workflowExecutionTerminal)
      .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
      .limit(1)
    if (terminalSnapshot?.result) return terminalSnapshot.result as ExecutionResult
    const [attempt] = await tx
      .select({ processingCompletedAt: workflowExecutionAttempt.processingCompletedAt })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId)
        )
      )
      .limit(1)
    if (!attempt || attempt.processingCompletedAt) {
      return terminalSnapshot?.result as ExecutionResult | null | undefined
    }
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const completedAt = requireDatabaseDate(databaseClock?.now, 'completion timestamp')
    const [participant] = await tx
      .select({ id: workflowExecutionParticipant.id })
      .from(workflowExecutionParticipant)
      .where(
        and(
          eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
          eq(workflowExecutionParticipant.attemptId, params.attemptId)
        )
      )
      .limit(1)
    const evidence = participant
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: params.rootExecutionId,
          attemptId: params.attemptId,
          participantId: participant.id,
          state: params.result.success ? 'completed' : 'failed',
          observedAt: completedAt,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId, {
          terminalCauseAt: completedAt,
          allowTerminalObservation: true,
        })
    if (
      !evidence ||
      evidence.state === 'closed' ||
      (!participant && evidence.state !== 'unlimited')
    ) {
      return
    }
    if (!(await isWorkflowExecutionAttemptOpen(tx, params.rootExecutionId, params.attemptId)))
      return
    const [closedAttempt] = await tx
      .update(workflowExecutionAttempt)
      .set({
        state: params.result.success ? 'completed' : 'failed',
        processingCompletedAt: completedAt,
      })
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId),
          isNull(workflowExecutionAttempt.processingCompletedAt)
        )
      )
      .returning({ id: workflowExecutionAttempt.id })
    if (!closedAttempt) throw new Error('Workflow execution attempt ownership was lost')

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
      terminal.appliedTierName &&
      terminal.limitSeconds &&
      terminal.deadlineCandidateAt
        ? createWorkflowDeadlineResult({
            policy: {
              kind: 'bounded',
              rootExecutionId: params.rootExecutionId,
              appliedTierId: terminal.appliedTierId,
              appliedTierName: terminal.appliedTierName,
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
            ne(workflowExecutionAttempt.pendingExecutionId, params.rootExecutionId)
          )
        )
      for (const descendant of descendants) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId: params.rootExecutionId,
            kind: `child_terminal:${descendant.pendingExecutionId}`,
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
          terminal.appliedTierName &&
          terminal.limitSeconds &&
          terminal.deadlineCandidateAt
          ? createWorkflowDeadlineResult({
              policy: {
                kind: 'bounded',
                rootExecutionId,
                appliedTierId: terminal.appliedTierId,
                appliedTierName: terminal.appliedTierName,
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
            ne(workflowExecutionAttempt.pendingExecutionId, rootExecutionId)
          )
        )
      for (const descendant of descendants) {
        await tx
          .insert(workflowExecutionOutbox)
          .values({
            rootExecutionId,
            kind: `child_terminal:${descendant.pendingExecutionId}`,
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

export async function scheduleWorkflowTerminationReconcile(
  rootExecutionId: string,
  immediately = false
) {
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
        availableAt: immediately
          ? sql`clock_timestamp()`
          : sql`clock_timestamp() + interval '10 seconds'`,
      })
      .onConflictDoNothing()
  })
}

export async function claimWorkflowOperationsForTermination(rootExecutionId: string) {
  const rows = await db.execute<{
    id: string
    root_execution_id: string
    attempt_id: string
    participant_id: string | null
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
      limit 1
    )
    update ${workflowExecutionOperation} operation
    set fencing_token = gen_random_uuid()::text,
        lease_expires_at = clock_timestamp() + interval '60 seconds',
        last_observed_at = clock_timestamp()
    from candidates
    where operation.id = candidates.id
    returning operation.id, operation.root_execution_id, operation.attempt_id,
              operation.participant_id, operation.capability, operation.adapter_kind,
              operation.remote_operation_id, operation.observation, operation.fencing_token
  `)
  return rows.map((row) => ({
    id: row.id,
    rootExecutionId: row.root_execution_id,
    attemptId: row.attempt_id,
    participantId: row.participant_id ?? undefined,
    capability: row.capability,
    adapterKind: row.adapter_kind,
    remoteOperationId: row.remote_operation_id,
    observation: row.observation,
    fencingToken: row.fencing_token,
  }))
}

export async function recordWorkflowOperationObservation(params: {
  operation: WorkflowExecutionOperationHandle
  fencingToken: string
  state?: 'canceled' | 'completed' | 'failed'
  observation?: Record<string, unknown>
}) {
  await db.transaction(async (tx) => {
    const [operation] = await tx
      .select({
        attemptId: workflowExecutionOperation.attemptId,
        fencingToken: workflowExecutionOperation.fencingToken,
        participantId: workflowExecutionOperation.participantId,
        rootExecutionId: workflowExecutionOperation.rootExecutionId,
        state: workflowExecutionOperation.state,
      })
      .from(workflowExecutionOperation)
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, params.operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, params.operation.attemptId),
          params.operation.participantId
            ? eq(workflowExecutionOperation.participantId, params.operation.participantId)
            : isNull(workflowExecutionOperation.participantId)
        )
      )
      .limit(1)
    if (
      !operation ||
      operation.fencingToken !== params.fencingToken ||
      operation.state !== 'cancel_requested'
    ) {
      return
    }
    const [databaseClock] = await tx.execute<{ now: unknown }>(sql`select clock_timestamp() as now`)
    const observedAt = requireDatabaseDate(databaseClock?.now, 'operation observation timestamp')
    const observation = sql.param(params.observation ?? {}, workflowExecutionOperation.observation)
    const nextReconcileAt = sql.param(observedAt, workflowExecutionOperation.nextReconcileAt)
    if (operation?.participantId) {
      const evidence = await transitionWorkflowExecutionParticipantInTransaction(tx, {
        rootExecutionId: operation.rootExecutionId,
        attemptId: operation.attemptId,
        participantId: operation.participantId,
        observedAt,
      })
      if (!evidence || evidence.state === 'closed') return
    } else if (operation) {
      const evidence = await reconcileWorkflowExecutionDeadlineInTransaction(
        tx,
        operation.rootExecutionId,
        { allowTerminalObservation: true }
      )
      if (evidence.state !== 'unlimited') return
    }
    const [recorded] = await tx
      .update(workflowExecutionOperation)
      .set(
        params.state
          ? {
              state: params.state,
              observation: terminalWorkflowOperationObservation(params.observation),
              terminalAt: observedAt,
              leaseExpiresAt: null,
              fencingToken: null,
              nextReconcileAt: null,
              updatedAt: observedAt,
            }
          : {
              observation: sql`coalesce(${workflowExecutionOperation.observation}, '{}'::jsonb)
                || ${observation}::jsonb`,
              leaseExpiresAt: null,
              fencingToken: null,
              nextReconcileAt: sql`${nextReconcileAt}::timestamptz + interval '10 seconds'`,
              updatedAt: observedAt,
            }
      )
      .where(
        and(
          eq(workflowExecutionOperation.id, params.operation.id),
          eq(workflowExecutionOperation.rootExecutionId, operation.rootExecutionId),
          eq(workflowExecutionOperation.attemptId, operation.attemptId),
          operation.participantId
            ? eq(workflowExecutionOperation.participantId, operation.participantId)
            : isNull(workflowExecutionOperation.participantId),
          eq(workflowExecutionOperation.fencingToken, params.fencingToken),
          eq(workflowExecutionOperation.state, 'cancel_requested')
        )
      )
      .returning({ id: workflowExecutionOperation.id })
    if (!recorded) throw new Error('Workflow operation fencing ownership was lost')
  })
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
    const [attempt] = await tx
      .select({
        id: workflowExecutionAttempt.id,
        processingCompletedAt: workflowExecutionAttempt.processingCompletedAt,
      })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId)
        )
      )
      .limit(1)
    if (!attempt || attempt.processingCompletedAt) return
    const attemptState = params.state
    const [participant] = await tx
      .select({ id: workflowExecutionParticipant.id })
      .from(workflowExecutionParticipant)
      .where(
        and(
          eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
          eq(workflowExecutionParticipant.attemptId, params.attemptId)
        )
      )
      .limit(1)
    const evidence = participant
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: params.rootExecutionId,
          attemptId: params.attemptId,
          participantId: participant.id,
          state: attemptState,
          observedAt: params.finishedAt,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId, {
          terminalCauseAt: params.finishedAt,
          allowTerminalObservation: true,
        })
    if (
      !evidence ||
      evidence.state === 'closed' ||
      (!participant && evidence.state !== 'unlimited')
    ) {
      return
    }
    if (!(await isWorkflowExecutionAttemptOpen(tx, params.rootExecutionId, params.attemptId)))
      return
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
    if (!closed) throw new Error('Workflow execution attempt ownership was lost')
    await tx
      .update(workflowExecutionOperation)
      .set({
        state: attemptState,
        observation: terminalWorkflowOperationObservation(),
        terminalAt: params.finishedAt,
        updatedAt: params.finishedAt,
      })
      .where(
        and(
          eq(workflowExecutionOperation.attemptId, params.attemptId),
          eq(workflowExecutionOperation.rootExecutionId, params.rootExecutionId),
          participant
            ? eq(workflowExecutionOperation.participantId, participant.id)
            : isNull(workflowExecutionOperation.participantId),
          eq(workflowExecutionOperation.capability, 'local'),
          inArray(workflowExecutionOperation.state, ['registered', 'running', 'cancel_requested'])
        )
      )
      .returning({ id: workflowExecutionOperation.id })
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
    const [attempt] = await tx
      .select({ processingCompletedAt: workflowExecutionAttempt.processingCompletedAt })
      .from(workflowExecutionAttempt)
      .where(
        and(
          eq(workflowExecutionAttempt.id, params.attemptId),
          eq(workflowExecutionAttempt.rootExecutionId, params.rootExecutionId)
        )
      )
      .limit(1)
    if (!attempt || attempt.processingCompletedAt) return
    const [participant] = await tx
      .select({ id: workflowExecutionParticipant.id })
      .from(workflowExecutionParticipant)
      .where(
        and(
          eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
          eq(workflowExecutionParticipant.attemptId, params.attemptId)
        )
      )
      .limit(1)
    const evidence = participant
      ? await transitionWorkflowExecutionParticipantInTransaction(tx, {
          rootExecutionId: params.rootExecutionId,
          attemptId: params.attemptId,
          participantId: participant.id,
          state: 'failed',
          observedAt: params.failedAt,
        })
      : await reconcileWorkflowExecutionDeadlineInTransaction(tx, params.rootExecutionId, {
          terminalCauseAt: params.failedAt,
          allowTerminalObservation: true,
        })
    if (
      !evidence ||
      evidence.state === 'closed' ||
      (!participant && evidence.state !== 'unlimited')
    ) {
      return
    }
    if (!(await isWorkflowExecutionAttemptOpen(tx, params.rootExecutionId, params.attemptId)))
      return
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
