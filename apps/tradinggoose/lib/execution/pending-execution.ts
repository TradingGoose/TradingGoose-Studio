import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { idempotencyKeys, tasks, timeout } from '@trigger.dev/sdk'
import { and, asc, eq, gt, lte, ne, sql } from 'drizzle-orm'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import {
  resolveServerExecutionBillingContext,
  resolveServerExecutionBillingTierForScope,
} from '@/lib/execution/execution-concurrency-limit'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState, TriggerExecutionUnavailableError } from '@/lib/trigger/settings'

export const PENDING_EXECUTION_TASK_ID = 'pending-execution'
export const PENDING_EXECUTION_LOCK_NAMESPACE = 29_401
const WORKFLOW_BLOCK_SOURCE = 'workflow_block'
const logger = createLogger('PendingExecutionQueue')
type TriggerExecutionState = Awaited<ReturnType<typeof getTriggerExecutionState>>

export type PendingExecutionType = 'workflow' | 'webhook' | 'schedule' | 'monitor' | 'document'

export type PendingExecutionPayload = Record<string, unknown>

type PendingExecutionInsert = {
  executionType: PendingExecutionType
  pendingExecutionId: string
  workflowId?: string | null
  workspaceId?: string | null
  userId: string
  source: string
  orderingKey?: string | null
  payload: PendingExecutionPayload
  requestId?: string
}

type PendingExecutionHandle = {
  pendingExecutionId: string
  billingScopeId: string
  inserted: boolean
}

type PendingExecutionRow = {
  id: string
  billingScopeId: string
  billingScopeType: string
  executionType: PendingExecutionType
  source: string
  userId: string
  workflowId: string | null
  workspaceId: string | null
  payload: unknown
  status: 'pending' | 'processing'
  nextAttemptAt: Date
  processingStartedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type PendingExecutionClaim = PendingExecutionRow & {
  payload: PendingExecutionPayload
}

export type PendingExecutionClaimResult =
  | { status: 'claimed'; row: PendingExecutionClaim }
  | { status: 'capacity_blocked'; pendingExecutionId: string }
  | { status: 'empty' }

export class PendingExecutionLimitError extends Error {
  statusCode = 429
  code = 'PENDING_EXECUTION_LIMIT' as const
  details: {
    pendingCount: number
    maxPendingCount: number
  }

  constructor(details: PendingExecutionLimitError['details']) {
    super('Pending execution backlog is full')
    this.name = 'PendingExecutionLimitError'
    this.details = details
  }
}

export const isPendingExecutionLimitError = (error: unknown): error is PendingExecutionLimitError =>
  error instanceof PendingExecutionLimitError

export function getTierPendingExecutionLimits(tier: BillingTierRecord) {
  return {
    maxPendingAgeSeconds: tier.maxPendingAgeSeconds ?? null,
    maxPendingCount: tier.maxPendingCount ?? null,
  }
}

async function getConcurrencyLimitForPendingExecution(
  row: Pick<PendingExecutionRow, 'billingScopeId' | 'billingScopeType'>
): Promise<number | null> {
  const tier = await resolveServerExecutionBillingTierForScope({
    scopeId: row.billingScopeId,
    scopeType: row.billingScopeType,
  })

  if (!tier) {
    return null
  }

  const limit = tier.concurrencyLimit
  if (limit === null) {
    return null
  }

  if (limit < 0) {
    throw new Error(`Billing tier ${tier.displayName} is missing concurrencyLimit`)
  }

  return limit
}

export function isPendingExecutionPayload(value: unknown): value is PendingExecutionPayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

// Workflow-block children are queued for durability, but capacity is held by the parent workflow.
const usesParentExecutionCapacity = (row: Pick<PendingExecutionRow, 'source'>) =>
  row.source === WORKFLOW_BLOCK_SOURCE

export function isTierLimitedPendingExecution(
  row: Pick<PendingExecutionClaim, 'executionType' | 'source'>
) {
  return (
    row.executionType === 'workflow' ||
    row.executionType === 'webhook' ||
    row.executionType === 'schedule' ||
    (row.executionType === 'monitor' && row.source === 'monitor:portfolio')
  )
}

export function getPendingExecutionTriggerKey(pendingExecutionId: string) {
  const digest = createHash('sha256').update(pendingExecutionId).digest('hex')
  return `${PENDING_EXECUTION_TASK_ID}:${digest}`
}

export async function triggerPendingExecution(row: PendingExecutionClaim) {
  const triggerKey = getPendingExecutionTriggerKey(row.id)
  const idempotencyKey = await idempotencyKeys.create(triggerKey, { scope: 'global' })
  const maxDuration = isTierLimitedPendingExecution(row)
    ? ((
        await resolveServerExecutionBillingTierForScope({
          scopeId: row.billingScopeId,
          scopeType: row.billingScopeType,
        })
      )?.workflowExecutionTimeLimitSeconds ?? timeout.None)
    : undefined

  await tasks.trigger(
    PENDING_EXECUTION_TASK_ID,
    { pendingExecutionId: row.id },
    {
      idempotencyKey,
      tags: [triggerKey],
      ...(maxDuration === undefined ? {} : { maxDuration }),
    }
  )
}

export async function dispatchNextPendingExecution(params: {
  billingScopeId: string
  requestId?: string
  triggerState?: TriggerExecutionState
}) {
  const triggerState = params.triggerState ?? (await getTriggerExecutionState())

  if (triggerState.mode === 'unavailable') {
    throw new TriggerExecutionUnavailableError()
  }

  if (triggerState.mode === 'local') {
    return { status: 'local_pending' as const }
  }

  const claim = await claimNextPendingExecution(params.billingScopeId)
  if (claim.status !== 'claimed') {
    return claim
  }

  // The row stays processing if Trigger admission is ambiguous. Recovery retries this
  // idempotent request without freeing capacity or replaying the workflow.
  await triggerPendingExecution(claim.row)

  return { status: 'dispatched' as const, pendingExecutionId: claim.row.id }
}

export async function wakePendingExecution(params: { billingScopeId: string; requestId?: string }) {
  try {
    const triggerState = await getTriggerExecutionState()

    while (true) {
      const result = await dispatchNextPendingExecution({ ...params, triggerState })
      if (result.status !== 'dispatched') {
        return result
      }
    }
  } catch (error) {
    logger.error('Pending execution wake failed', {
      billingScopeId: params.billingScopeId,
      requestId: params.requestId,
      error,
    })
  }
}

export async function enqueuePendingExecution(
  params: PendingExecutionInsert
): Promise<PendingExecutionHandle> {
  const triggerState = await getTriggerExecutionState()

  if (triggerState.mode === 'unavailable') {
    throw new TriggerExecutionUnavailableError()
  }

  let inserted = false

  const billingContext = await resolveServerExecutionBillingContext({
    actorUserId: params.userId,
    workflowId: params.workflowId,
    workspaceId: params.workspaceId,
    requestId: params.requestId,
    source: params.source,
  })
  const billingScopeId = billingContext ? billingContext.scopeId : params.userId
  const billingScopeType = billingContext ? billingContext.scopeType : 'user'
  const limits = billingContext
    ? getTierPendingExecutionLimits(billingContext.tier)
    : {
        maxPendingAgeSeconds: null,
        maxPendingCount: null,
      }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${billingScopeId}))`
    )

    if (limits.maxPendingAgeSeconds !== null) {
      const staleBefore = new Date(Date.now() - limits.maxPendingAgeSeconds * 1000)

      await tx
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            eq(pendingExecution.status, 'pending'),
            lte(pendingExecution.createdAt, staleBefore)
          )
        )
    }

    const [existingRow] = await tx
      .select({ id: pendingExecution.id })
      .from(pendingExecution)
      .where(eq(pendingExecution.id, params.pendingExecutionId))
      .limit(1)

    if (existingRow) {
      return
    }

    if (params.executionType === 'workflow') {
      const [existingLog] = await tx
        .select({ id: workflowExecutionLogs.id })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, params.pendingExecutionId))
        .limit(1)

      if (existingLog) {
        return
      }
    }

    if (params.orderingKey) {
      const [overlappingRow] = await tx
        .select({ id: pendingExecution.id })
        .from(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            eq(pendingExecution.orderingKey, params.orderingKey),
            sql<boolean>`${pendingExecution.status} in ('pending', 'processing')`
          )
        )
        .limit(1)

      if (overlappingRow) {
        return
      }
    }

    if (limits.maxPendingCount !== null) {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            eq(pendingExecution.status, 'pending')
          )
        )

      const pendingCount = Number(countRow?.count ?? 0)
      if (pendingCount >= limits.maxPendingCount) {
        throw new PendingExecutionLimitError({
          pendingCount,
          maxPendingCount: limits.maxPendingCount,
        })
      }
    }

    await tx.insert(pendingExecution).values({
      id: params.pendingExecutionId,
      billingScopeId,
      billingScopeType,
      executionType: params.executionType,
      orderingKey: params.orderingKey ?? null,
      source: params.source,
      userId: params.userId,
      workflowId: params.workflowId ?? null,
      workspaceId: params.workspaceId ?? null,
      payload: params.payload,
    })
    inserted = true
  })

  if (!inserted) {
    if (params.orderingKey) {
      await wakePendingExecution({
        billingScopeId,
        requestId: params.requestId,
      })
    }
    return {
      pendingExecutionId: params.pendingExecutionId,
      billingScopeId,
      inserted,
    }
  }

  try {
    await dispatchNextPendingExecution({
      billingScopeId,
      requestId: params.requestId,
      triggerState,
    })
  } catch (error) {
    await db
      .delete(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.status, 'pending')
        )
      )
    throw error
  }

  return {
    pendingExecutionId: params.pendingExecutionId,
    billingScopeId,
    inserted,
  }
}

export async function claimNextPendingExecution(
  billingScopeId: string
): Promise<PendingExecutionClaimResult> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${billingScopeId}))`
    )

    const [candidate] = await tx
      .select()
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.billingScopeId, billingScopeId),
          eq(pendingExecution.status, 'pending'),
          lte(pendingExecution.nextAttemptAt, new Date())
        )
      )
      .orderBy(
        asc(pendingExecution.nextAttemptAt),
        asc(pendingExecution.createdAt),
        asc(pendingExecution.id)
      )
      .limit(1)

    if (!candidate) {
      return { status: 'empty' }
    }

    let claimCandidate = candidate
    if (!usesParentExecutionCapacity(candidate)) {
      const concurrencyLimit = await getConcurrencyLimitForPendingExecution(candidate)

      if (concurrencyLimit !== null) {
        const [activeRow] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(pendingExecution)
          .where(
            and(
              eq(pendingExecution.billingScopeId, billingScopeId),
              eq(pendingExecution.status, 'processing'),
              ne(pendingExecution.source, WORKFLOW_BLOCK_SOURCE)
            )
          )
          .limit(1)

        const activeCount = Number(activeRow?.count ?? 0)
        if (activeCount >= concurrencyLimit) {
          const [childCandidate] = await tx
            .select()
            .from(pendingExecution)
            .where(
              and(
                eq(pendingExecution.billingScopeId, billingScopeId),
                eq(pendingExecution.status, 'pending'),
                eq(pendingExecution.source, WORKFLOW_BLOCK_SOURCE),
                lte(pendingExecution.nextAttemptAt, new Date())
              )
            )
            .orderBy(
              asc(pendingExecution.nextAttemptAt),
              asc(pendingExecution.createdAt),
              asc(pendingExecution.id)
            )
            .limit(1)

          if (!childCandidate) {
            return { status: 'capacity_blocked', pendingExecutionId: candidate.id }
          }
          claimCandidate = childCandidate
        }
      }
    }

    const [claimed] = await tx
      .update(pendingExecution)
      .set({
        status: 'processing',
        processingStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(pendingExecution.id, claimCandidate.id), eq(pendingExecution.status, 'pending'))
      )
      .returning()

    if (!claimed) {
      throw new Error(`Pending execution ${claimCandidate.id} could not be claimed`)
    }

    return { status: 'claimed', row: asPendingExecutionClaim(claimed) }
  })
}

export async function getProcessingPendingExecution(
  pendingExecutionId: string
): Promise<PendingExecutionClaim | null> {
  const [row] = await db
    .select()
    .from(pendingExecution)
    .where(
      and(eq(pendingExecution.id, pendingExecutionId), eq(pendingExecution.status, 'processing'))
    )
    .limit(1)

  return row ? asPendingExecutionClaim(row) : null
}

export async function isPendingWorkflowExecutionCancellationRequested(pendingExecutionId: string) {
  const [row] = await db
    .select({
      payload: pendingExecution.payload,
    })
    .from(pendingExecution)
    .where(eq(pendingExecution.id, pendingExecutionId))
    .limit(1)

  if (!row) return false

  const payload = isPendingExecutionPayload(row.payload) ? row.payload : {}
  return typeof payload.cancelRequestedAt === 'string'
}

export function isPendingExecutionOwnerCompleted(row: Pick<PendingExecutionClaim, 'payload'>) {
  return typeof row.payload.ownerCompletedAt === 'string'
}

export async function markPendingExecutionOwnerCompleted(row: PendingExecutionClaim) {
  const ownerCompletedAt = new Date().toISOString()
  await db
    .update(pendingExecution)
    .set({
      payload: sql`${pendingExecution.payload} || jsonb_build_object('ownerCompletedAt', ${ownerCompletedAt})`,
      updatedAt: new Date(),
    })
    .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
}

function asPendingExecutionClaim(row: typeof pendingExecution.$inferSelect): PendingExecutionClaim {
  return {
    ...row,
    payload: isPendingExecutionPayload(row.payload) ? row.payload : {},
  } as PendingExecutionClaim
}

export async function hasPendingExecutions() {
  const [row] = await db.select({ id: pendingExecution.id }).from(pendingExecution).limit(1)
  return Boolean(row)
}

export async function listProcessingPendingExecutions(params: { afterId?: string; limit: number }) {
  const rows = await db
    .select()
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.status, 'processing'),
        params.afterId ? gt(pendingExecution.id, params.afterId) : undefined
      )
    )
    .orderBy(asc(pendingExecution.id))
    .limit(params.limit)

  return rows.map(asPendingExecutionClaim)
}

export async function listPendingExecutionBillingScopes(params: {
  afterBillingScopeId?: string
  limit: number
}) {
  return db
    .selectDistinct({ billingScopeId: pendingExecution.billingScopeId })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.status, 'pending'),
        params.afterBillingScopeId
          ? gt(pendingExecution.billingScopeId, params.afterBillingScopeId)
          : undefined
      )
    )
    .orderBy(asc(pendingExecution.billingScopeId))
    .limit(params.limit)
}

export async function listChildPendingWorkflowExecutions(parentExecutionId: string) {
  const rows = await db
    .select()
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.executionType, 'workflow'),
        sql<boolean>`${pendingExecution.payload}->'metadata'->>'parentExecutionId' = ${parentExecutionId}`
      )
    )
    .orderBy(asc(pendingExecution.createdAt), asc(pendingExecution.id))

  return rows.map(asPendingExecutionClaim)
}

export async function completePendingExecution(params: { pendingExecutionId: string }) {
  // The queue row is the active capacity marker; terminal state belongs to the execution owner.
  const [deleted] = await db
    .delete(pendingExecution)
    .where(eq(pendingExecution.id, params.pendingExecutionId))
    .returning({ billingScopeId: pendingExecution.billingScopeId })

  if (deleted?.billingScopeId) {
    await wakePendingExecution({
      billingScopeId: deleted.billingScopeId,
    })
  }
}
