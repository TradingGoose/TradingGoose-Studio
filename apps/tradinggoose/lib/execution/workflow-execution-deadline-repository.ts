import { db } from '@tradinggoose/db'
import {
  workflowExecutionDeadline,
  workflowExecutionOperation,
  workflowExecutionOutbox,
  workflowExecutionParticipant,
  workflowExecutionTerminal,
} from '@tradinggoose/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { requireDatabaseDate, requireNullableDatabaseDate } from './database-date'

export const NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE = false
const MAX_RECONCILE_DELAY_MILLISECONDS = 60_000

export type WorkflowDeadlineReconcileResult =
  | { state: 'unlimited' }
  | { state: 'closed' }
  | { state: 'accounted' }
  | { state: 'scheduled'; delayMilliseconds: number }
  | { state: 'exhausted'; exhaustedAt: Date }

type DeadlineTransaction = Pick<typeof db, 'execute' | 'select' | 'update' | 'insert'>

export async function reconcileWorkflowExecutionDeadlineInTransaction(
  tx: DeadlineTransaction,
  rootExecutionId: string,
  options?: {
    terminalCauseAt?: Date
    allowTerminalObservation?: boolean
  }
): Promise<WorkflowDeadlineReconcileResult> {
  await tx.execute(
    sql`select ${workflowExecutionTerminal.rootExecutionId}
          from ${workflowExecutionTerminal}
          where ${workflowExecutionTerminal.rootExecutionId} = ${rootExecutionId}
          for update`
  )
  const [terminal] = await tx
    .select({
      state: workflowExecutionTerminal.state,
      dispatchOpen: workflowExecutionTerminal.dispatchOpen,
      policyState: workflowExecutionTerminal.policyState,
      deadlineCandidateAt: workflowExecutionTerminal.deadlineCandidateAt,
      result: workflowExecutionTerminal.result,
    })
    .from(workflowExecutionTerminal)
    .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
    .limit(1)
  const acceptsTerminalObservation =
    options?.allowTerminalObservation &&
    terminal?.state === 'termination_pending' &&
    !terminal.result
  if (
    !terminal ||
    (!acceptsTerminalObservation && (terminal.state !== 'running' || !terminal.dispatchOpen))
  ) {
    if (!terminal || terminal.result || terminal.state === 'terminal') return { state: 'closed' }
    if (terminal?.deadlineCandidateAt) {
      return { state: 'exhausted', exhaustedAt: terminal.deadlineCandidateAt }
    }
    return { state: 'closed' }
  }
  if (terminal.policyState === 'unlimited') return { state: 'unlimited' }

  const observationTime = options?.terminalCauseAt
    ? sql`${sql.param(
        options.terminalCauseAt,
        workflowExecutionTerminal.deadlineCandidateAt
      )}::timestamptz`
    : sql`clock_timestamp()`
  const rows = await tx.execute<{
    counted_microseconds: string
    limit_microseconds: string
    exhausted_at: unknown
    wake_milliseconds: number
    schedule_version: number
    next_reconcile_at: unknown
  }>(sql`
      with clock as (
        select ${observationTime} as now
      ), locked_deadline as (
        select deadline.*
        from ${workflowExecutionDeadline} deadline
        where deadline.root_execution_id = ${rootExecutionId}
        for update
      ), activity as (
        select
          max(participant.lease_expires_at)
            filter (where participant.state = 'active') as active_until,
          max(participant.lease_expires_at)
            filter (where participant.state in ('active', 'waiting_child')) as live_until
        from ${workflowExecutionParticipant} participant
        where participant.root_execution_id = ${rootExecutionId}
      ), accounting as (
        select locked_deadline.*,
          greatest(clock.now, locked_deadline.last_accounted_at) as now,
          activity.active_until,
          activity.live_until,
          case
            when activity.live_until is null then locked_deadline.last_accounted_at
            when ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
              then greatest(
                locked_deadline.last_accounted_at,
                least(greatest(clock.now, locked_deadline.last_accounted_at), activity.live_until)
              )
            when activity.active_until is not null then greatest(
              locked_deadline.last_accounted_at,
              least(greatest(clock.now, locked_deadline.last_accounted_at), activity.active_until)
            )
            else locked_deadline.last_accounted_at
          end as counted_until
        from locked_deadline cross join clock cross join activity
      ), calculated as (
        select accounting.*,
          greatest(
            0,
            floor(extract(epoch from (
              accounting.counted_until - accounting.last_accounted_at
            )) * 1000000)
          )::numeric as accrued,
          case
            when accounting.live_until is null then accounting.now
            when ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
              then case
                when accounting.live_until >= accounting.now then accounting.now
                else accounting.counted_until
              end
            when accounting.active_until is null then accounting.now
            when accounting.active_until >= accounting.now then accounting.now
            else accounting.counted_until
          end as accounted_until
        from accounting
      ), scheduled as (
        select calculated.*,
          least(
            calculated.now + interval '60 seconds',
            calculated.now +
              ((least(
                60000000::numeric,
                greatest(
                  1,
                  calculated.limit_microseconds -
                    least(
                      calculated.limit_microseconds,
                      calculated.counted_microseconds + calculated.accrued
                    )
                )
              ))::text || ' microseconds')::interval,
            case
              when ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
                and calculated.live_until >= calculated.now
                then calculated.live_until
              when not ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
                and calculated.active_until >= calculated.now
                then calculated.active_until
              else calculated.now + interval '60 seconds'
            end
          ) as next_wake_at
        from calculated
      ), updated as (
        update ${workflowExecutionDeadline} deadline
        set counted_microseconds = least(
              scheduled.limit_microseconds,
              scheduled.counted_microseconds + scheduled.accrued
            ),
            last_accounted_at = scheduled.accounted_until,
            next_reconcile_at = scheduled.next_wake_at,
            schedule_version = deadline.schedule_version + 1,
            updated_at = scheduled.now
        from scheduled
        where deadline.root_execution_id = scheduled.root_execution_id
        returning deadline.*
      ), reconciled as (
        select updated.*,
          case when scheduled.counted_microseconds + scheduled.accrued
                    >= scheduled.limit_microseconds
            then scheduled.last_accounted_at +
              ((scheduled.limit_microseconds - scheduled.counted_microseconds)::text ||
                ' microseconds')::interval
            else null
          end as exhausted_at,
          scheduled.now as observed_at
        from updated
        inner join scheduled
          on scheduled.root_execution_id = updated.root_execution_id
      ), terminalized as (
        update ${workflowExecutionTerminal} terminal
        set state = 'termination_pending',
            dispatch_open = false,
            termination_requested_at = least(
              coalesce(terminal.termination_requested_at, reconciled.exhausted_at),
              reconciled.exhausted_at
            ),
            deadline_candidate_at = least(
              coalesce(terminal.deadline_candidate_at, reconciled.exhausted_at),
              reconciled.exhausted_at
            ),
            barrier_version = terminal.barrier_version + 1,
            updated_at = reconciled.observed_at
        from reconciled
        where terminal.root_execution_id = reconciled.root_execution_id
          and terminal.state in ('running', 'termination_pending')
          and terminal.result is null
          and reconciled.exhausted_at is not null
        returning terminal.root_execution_id
      )
      select counted_microseconds, limit_microseconds, exhausted_at, schedule_version,
        next_reconcile_at,
        greatest(
          1,
          ceil(extract(epoch from (next_reconcile_at - observed_at)) * 1000)
        )::integer as wake_milliseconds
      from reconciled
    `)
  const row = rows[0]
  if (!row) {
    throw new Error(`Missing bounded deadline for workflow execution ${rootExecutionId}`)
  }
  const exhaustedAt = requireNullableDatabaseDate(row.exhausted_at, 'deadline-exhaustion timestamp')
  const nextReconcileAt = requireDatabaseDate(
    row.next_reconcile_at,
    'deadline-reconciliation timestamp'
  )
  if (exhaustedAt) {
    await tx
      .update(workflowExecutionOperation)
      .set({
        state: 'cancel_requested',
        nextReconcileAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowExecutionOperation.rootExecutionId, rootExecutionId),
          inArray(workflowExecutionOperation.state, ['registered', 'running'])
        )
      )
    await tx
      .insert(workflowExecutionOutbox)
      .values({
        rootExecutionId,
        kind: 'termination_reconcile',
        version: row.schedule_version,
        payload: { rootExecutionId, scheduleVersion: row.schedule_version },
      })
      .onConflictDoNothing()
    return { state: 'exhausted', exhaustedAt }
  }
  if (options?.terminalCauseAt || acceptsTerminalObservation) return { state: 'accounted' }
  await tx
    .insert(workflowExecutionOutbox)
    .values({
      rootExecutionId,
      kind: 'deadline_reconcile',
      version: row.schedule_version,
      payload: { rootExecutionId, scheduleVersion: row.schedule_version },
      availableAt: nextReconcileAt,
    })
    .onConflictDoNothing()
  return {
    state: 'scheduled',
    delayMilliseconds: Math.min(
      MAX_RECONCILE_DELAY_MILLISECONDS,
      Math.max(1, row.wake_milliseconds)
    ),
  }
}

export async function reconcileWorkflowExecutionDeadline(
  rootExecutionId: string
): Promise<WorkflowDeadlineReconcileResult> {
  return db.transaction((tx) =>
    reconcileWorkflowExecutionDeadlineInTransaction(tx, rootExecutionId)
  )
}

export async function transitionWorkflowExecutionParticipantInTransaction(
  tx: DeadlineTransaction,
  params: {
    rootExecutionId: string
    attemptId: string
    participantId: string
    state?: 'active' | 'waiting_child' | 'canceled' | 'completed' | 'failed'
    observedAt?: Date
  }
) {
  await tx.execute(
    sql`select ${workflowExecutionTerminal.rootExecutionId}
        from ${workflowExecutionTerminal}
        where ${workflowExecutionTerminal.rootExecutionId} = ${params.rootExecutionId}
        for update`
  )
  const [terminal] = await tx
    .select({
      result: workflowExecutionTerminal.result,
      state: workflowExecutionTerminal.state,
    })
    .from(workflowExecutionTerminal)
    .where(eq(workflowExecutionTerminal.rootExecutionId, params.rootExecutionId))
    .limit(1)
  if (!terminal || terminal.result || terminal.state === 'terminal') return
  if (terminal.state !== 'running' && !params.observedAt) return
  await tx.execute(
    sql`select ${workflowExecutionDeadline.rootExecutionId}
        from ${workflowExecutionDeadline}
        where ${workflowExecutionDeadline.rootExecutionId} = ${params.rootExecutionId}
        for update`
  )
  const [lockedParticipant] = await tx
    .select({
      attemptId: workflowExecutionParticipant.attemptId,
      rootExecutionId: workflowExecutionParticipant.rootExecutionId,
      state: workflowExecutionParticipant.state,
    })
    .from(workflowExecutionParticipant)
    .where(
      and(
        eq(workflowExecutionParticipant.id, params.participantId),
        eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
        eq(workflowExecutionParticipant.attemptId, params.attemptId)
      )
    )
    .limit(1)
  if (!lockedParticipant) return
  if (
    lockedParticipant.rootExecutionId !== params.rootExecutionId ||
    lockedParticipant.attemptId !== params.attemptId
  ) {
    return
  }
  if (!['active', 'waiting_child'].includes(lockedParticipant.state)) {
    if (params.observedAt && (!params.state || params.state === lockedParticipant.state)) {
      return { state: 'accounted' } as const
    }
    return
  }
  const observedAt = params.observedAt
    ? sql`${sql.param(params.observedAt, workflowExecutionParticipant.lastHeartbeatAt)}::timestamptz`
    : sql`clock_timestamp()`
  const [renewedParticipant] = await tx
    .update(workflowExecutionParticipant)
    .set({
      lastHeartbeatAt: observedAt,
      leaseExpiresAt: sql`${observedAt} + interval '60 seconds'`,
      updatedAt: observedAt,
    })
    .where(
      and(
        eq(workflowExecutionParticipant.id, params.participantId),
        eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
        eq(workflowExecutionParticipant.attemptId, params.attemptId),
        eq(workflowExecutionParticipant.state, lockedParticipant.state)
      )
    )
    .returning({ id: workflowExecutionParticipant.id })
  if (!renewedParticipant) return
  const reconciliation = await reconcileWorkflowExecutionDeadlineInTransaction(
    tx,
    params.rootExecutionId,
    {
      terminalCauseAt: params.observedAt,
      allowTerminalObservation: Boolean(params.observedAt),
    }
  )
  if (params.state) {
    const [transitionedParticipant] = await tx
      .update(workflowExecutionParticipant)
      .set({ state: params.state, updatedAt: observedAt })
      .where(
        and(
          eq(workflowExecutionParticipant.id, params.participantId),
          eq(workflowExecutionParticipant.rootExecutionId, params.rootExecutionId),
          eq(workflowExecutionParticipant.attemptId, params.attemptId),
          eq(workflowExecutionParticipant.state, lockedParticipant.state)
        )
      )
      .returning({ id: workflowExecutionParticipant.id })
    if (!transitionedParticipant) {
      throw new Error('Workflow participant transition ownership was lost')
    }
  }
  return reconciliation
}

export async function setWorkflowExecutionParticipantState(params: {
  rootExecutionId: string
  attemptId: string
  participantId: string
  state: 'active' | 'waiting_child' | 'canceled' | 'completed' | 'failed'
}) {
  return db.transaction((tx) => transitionWorkflowExecutionParticipantInTransaction(tx, params))
}

export async function heartbeatWorkflowExecutionParticipant(params: {
  rootExecutionId: string
  attemptId: string
  participantId: string
}) {
  return db.transaction((tx) => transitionWorkflowExecutionParticipantInTransaction(tx, params))
}

export async function refreshWorkflowExecutionAttemptParticipant(attemptId: string) {
  await db.transaction(async (tx) => {
    const [participant] = await tx
      .select({
        attemptId: workflowExecutionParticipant.attemptId,
        id: workflowExecutionParticipant.id,
        rootExecutionId: workflowExecutionParticipant.rootExecutionId,
      })
      .from(workflowExecutionParticipant)
      .where(eq(workflowExecutionParticipant.attemptId, attemptId))
      .limit(1)
    if (!participant) return
    await transitionWorkflowExecutionParticipantInTransaction(tx, {
      rootExecutionId: participant.rootExecutionId,
      attemptId: participant.attemptId,
      participantId: participant.id,
    })
  })
}

export async function listDueWorkflowExecutionDeadlines(limit = 100) {
  return db
    .select({ rootExecutionId: workflowExecutionDeadline.rootExecutionId })
    .from(workflowExecutionDeadline)
    .innerJoin(
      workflowExecutionTerminal,
      eq(workflowExecutionTerminal.rootExecutionId, workflowExecutionDeadline.rootExecutionId)
    )
    .where(
      and(
        eq(workflowExecutionTerminal.state, 'running'),
        sql`${workflowExecutionDeadline.nextReconcileAt} <= clock_timestamp()`
      )
    )
    .limit(limit)
}
