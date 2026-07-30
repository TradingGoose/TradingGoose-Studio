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
  | { state: 'inactive' }
  | { state: 'scheduled'; delayMilliseconds: number }
  | { state: 'exhausted'; exhaustedAt: Date }

type DeadlineTransaction = Pick<typeof db, 'execute' | 'select' | 'update' | 'insert'>

export async function reconcileWorkflowExecutionDeadlineInTransaction(
  tx: DeadlineTransaction,
  rootExecutionId: string
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
    })
    .from(workflowExecutionTerminal)
    .where(eq(workflowExecutionTerminal.rootExecutionId, rootExecutionId))
    .limit(1)
  if (!terminal || terminal.state !== 'running' || !terminal.dispatchOpen) {
    return { state: 'inactive' }
  }

  const rows = await tx.execute<{
    counted_microseconds: string
    limit_microseconds: string
    exhausted_at: unknown
    wake_milliseconds: number
    schedule_version: number
    next_reconcile_at: unknown
  }>(sql`
      with clock as (
        select clock_timestamp() as now
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
          clock.now,
          activity.active_until,
          activity.live_until,
          case
            when activity.live_until is null then locked_deadline.last_accounted_at
            when ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
              then greatest(
                locked_deadline.last_accounted_at,
                least(clock.now, activity.live_until)
              )
            when activity.active_until is not null then greatest(
              locked_deadline.last_accounted_at,
              least(clock.now, activity.active_until)
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
          )::numeric as accrued
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
            coalesce(
              case
                when ${NESTED_WORKFLOW_QUEUE_WAIT_COUNTS_TOWARD_DEADLINE}
                  then calculated.live_until
                else calculated.active_until
              end,
              calculated.now + interval '60 seconds'
            )
          ) as next_wake_at
        from calculated
      ), updated as (
        update ${workflowExecutionDeadline} deadline
        set counted_microseconds = least(
              calculated.limit_microseconds,
              calculated.counted_microseconds + calculated.accrued
            ),
            last_accounted_at = calculated.now,
            next_reconcile_at = scheduled.next_wake_at,
            schedule_version = deadline.schedule_version + 1,
            updated_at = calculated.now
        from scheduled
        where deadline.root_execution_id = scheduled.root_execution_id
        returning deadline.*,
          case when scheduled.counted_microseconds + scheduled.accrued
                    >= scheduled.limit_microseconds
            then scheduled.last_accounted_at +
              ((scheduled.limit_microseconds - scheduled.counted_microseconds)::text ||
                ' microseconds')::interval
            else null
          end as exhausted_at,
          scheduled.now as observed_at
      ), terminalized as (
        update ${workflowExecutionTerminal} terminal
        set state = 'termination_pending',
            dispatch_open = false,
            termination_requested_at = updated.exhausted_at,
            deadline_candidate_at = updated.exhausted_at,
            barrier_version = terminal.barrier_version + 1,
            updated_at = updated.observed_at
        from updated
        where terminal.root_execution_id = updated.root_execution_id
          and terminal.state = 'running'
          and updated.exhausted_at is not null
        returning terminal.root_execution_id
      )
      select counted_microseconds, limit_microseconds, exhausted_at, schedule_version,
        next_reconcile_at,
        greatest(
          1,
          ceil(extract(epoch from (next_reconcile_at - observed_at)) * 1000)
        )::integer as wake_milliseconds
      from updated
    `)
  const row = rows[0]
  if (!row) return { state: 'inactive' }
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

export async function setWorkflowExecutionParticipantState(params: {
  participantId: string
  state: 'active' | 'waiting_child' | 'canceled' | 'completed' | 'failed'
}) {
  await db.transaction(async (tx) => {
    const [participant] = await tx
      .select({ rootExecutionId: workflowExecutionParticipant.rootExecutionId })
      .from(workflowExecutionParticipant)
      .where(eq(workflowExecutionParticipant.id, params.participantId))
      .limit(1)
    if (!participant) return
    await reconcileWorkflowExecutionDeadlineInTransaction(tx, participant.rootExecutionId)
    await tx
      .update(workflowExecutionParticipant)
      .set({
        state: params.state,
        lastHeartbeatAt: sql`clock_timestamp()`,
        leaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(workflowExecutionParticipant.id, params.participantId))
  })
}

export async function heartbeatWorkflowExecutionParticipant(participantId: string) {
  await db.transaction(async (tx) => {
    const [participant] = await tx
      .select({
        rootExecutionId: workflowExecutionParticipant.rootExecutionId,
        state: workflowExecutionParticipant.state,
      })
      .from(workflowExecutionParticipant)
      .where(eq(workflowExecutionParticipant.id, participantId))
      .limit(1)
    if (!participant || !['active', 'waiting_child'].includes(participant.state)) return
    await reconcileWorkflowExecutionDeadlineInTransaction(tx, participant.rootExecutionId)
    await tx
      .update(workflowExecutionParticipant)
      .set({
        lastHeartbeatAt: sql`clock_timestamp()`,
        leaseExpiresAt: sql`clock_timestamp() + interval '60 seconds'`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(workflowExecutionParticipant.id, participantId),
          inArray(workflowExecutionParticipant.state, ['active', 'waiting_child'])
        )
      )
  })
}

export async function refreshWorkflowExecutionAttemptParticipant(attemptId: string) {
  const [participant] = await db
    .select({ id: workflowExecutionParticipant.id })
    .from(workflowExecutionParticipant)
    .where(eq(workflowExecutionParticipant.attemptId, attemptId))
    .limit(1)
  if (participant) await heartbeatWorkflowExecutionParticipant(participant.id)
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
