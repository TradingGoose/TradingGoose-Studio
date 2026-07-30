import { db } from '@tradinggoose/db'
import { workflowExecutionOutbox } from '@tradinggoose/db/schema'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { and, eq, sql } from 'drizzle-orm'

export async function claimWorkflowExecutionOutbox(limit = 100) {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      root_execution_id: string
      kind: string
      version: number
      payload: unknown
      fencing_token: string
    }>(sql`
      with candidates as (
        select candidate.root_execution_id, candidate.kind, candidate.version
        from ${workflowExecutionOutbox} candidate
        where candidate.available_at <= clock_timestamp()
          and (
            candidate.state = 'pending'
            or (
              candidate.state = 'claimed'
              and candidate.claim_expires_at < clock_timestamp()
            )
          )
          and (
            candidate.kind <> 'pending_execution'
            or (
              select count(*)
              from ${workflowExecutionOutbox} prerequisite
              where prerequisite.root_execution_id = candidate.root_execution_id
                and prerequisite.version = candidate.version
                and prerequisite.kind in ('workflow_log', 'terminal_event')
                and prerequisite.state = 'completed'
            ) = 2
          )
        order by candidate.available_at,
                 candidate.root_execution_id,
                 candidate.kind,
                 candidate.version
        for update skip locked
        limit ${limit}
      )
      update ${workflowExecutionOutbox} as outbox
      set state = 'claimed',
          fencing_token = gen_random_uuid()::text,
          claim_expires_at = clock_timestamp() + interval '60 seconds',
          attempt_count = outbox.attempt_count + 1
      from candidates
      where outbox.root_execution_id = candidates.root_execution_id
        and outbox.kind = candidates.kind
        and outbox.version = candidates.version
      returning outbox.root_execution_id, outbox.kind, outbox.version, outbox.payload,
                outbox.fencing_token
    `)
    return rows.map((row) => ({
      rootExecutionId: row.root_execution_id,
      kind: row.kind,
      version: row.version,
      payload: row.payload,
      fencingToken: row.fencing_token,
    }))
  })
}

export type WorkflowExecutionOutboxClaim = Awaited<
  ReturnType<typeof claimWorkflowExecutionOutbox>
>[number]

export async function completeWorkflowExecutionOutbox(params: {
  rootExecutionId: string
  kind: string
  version: number
  fencingToken: string
}) {
  await db
    .update(workflowExecutionOutbox)
    .set({
      state: 'completed',
      completedAt: sql`clock_timestamp()`,
      claimExpiresAt: null,
      fencingToken: null,
      lastError: null,
    })
    .where(
      and(
        eq(workflowExecutionOutbox.rootExecutionId, params.rootExecutionId),
        eq(workflowExecutionOutbox.kind, params.kind),
        eq(workflowExecutionOutbox.version, params.version),
        eq(workflowExecutionOutbox.fencingToken, params.fencingToken)
      )
    )
}

export async function failWorkflowExecutionOutbox(params: {
  rootExecutionId: string
  kind: string
  version: number
  fencingToken: string
  error: string
}) {
  await db
    .update(workflowExecutionOutbox)
    .set({
      state: 'pending',
      availableAt: sql`clock_timestamp() + interval '10 seconds'`,
      claimExpiresAt: null,
      fencingToken: null,
      lastError: params.error,
    })
    .where(
      and(
        eq(workflowExecutionOutbox.rootExecutionId, params.rootExecutionId),
        eq(workflowExecutionOutbox.kind, params.kind),
        eq(workflowExecutionOutbox.version, params.version),
        eq(workflowExecutionOutbox.fencingToken, params.fencingToken)
      )
    )
}

export async function dispatchWorkflowExecutionOutbox(claim: WorkflowExecutionOutboxClaim) {
  const taskId =
    claim.kind === 'deadline_reconcile'
      ? 'workflow-execution-reconcile'
      : claim.kind === 'termination_reconcile'
        ? 'workflow-execution-termination-reconcile'
        : 'workflow-execution-project'
  const idempotencyKey = await idempotencyKeys.create(
    `workflow-lifecycle:${claim.rootExecutionId}:${claim.kind}:${claim.version}:${claim.fencingToken}`,
    { scope: 'global' }
  )
  try {
    await tasks.trigger(taskId, claim, { idempotencyKey })
  } catch (error) {
    await failWorkflowExecutionOutbox({
      ...claim,
      error: error instanceof Error ? error.message : 'Outbox dispatch failed',
    })
    throw error
  }
}
