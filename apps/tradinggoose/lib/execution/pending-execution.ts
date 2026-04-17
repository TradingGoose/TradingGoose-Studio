import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { resolveServerExecutionBillingContext } from '@/lib/execution/execution-concurrency-limit'
import { ensureTriggerExecutionEnabled } from '@/lib/trigger/settings'

export const PENDING_EXECUTION_DRAIN_TASK_ID = 'pending-execution-drain'
export const PENDING_EXECUTION_RETRY_DELAY_MS = 15_000

const CLAIM_ATTEMPT_LIMIT = 5
const STALE_PROCESSING_WINDOW_MS = 30 * 60 * 1000
const PENDING_EXECUTION_LOCK_NAMESPACE = 29_401

export type PendingExecutionType =
  | 'workflow'
  | 'webhook'
  | 'schedule'
  | 'indicator_monitor'
  | 'document'

type PendingExecutionPayload = Record<string, unknown>

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
}

type PendingExecutionRow = {
  id: string
  billingScopeId: string
  billingScopeType: string
  executionType: string
  orderingKey: string | null
  source: string
  userId: string
  workflowId: string | null
  workspaceId: string | null
  payload: unknown
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  nextAttemptAt: Date
  processingStartedAt: Date | null
  errorMessage: string | null
  result: unknown
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type PendingExecutionClaim = PendingExecutionRow & {
  payload: PendingExecutionPayload
}

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

export const isPendingExecutionLimitError = (
  error: unknown,
): error is PendingExecutionLimitError =>
  error instanceof PendingExecutionLimitError

export function getTierPendingExecutionLimits(tier: BillingTierRecord) {
  return {
    maxPendingAgeSeconds: tier.maxPendingAgeSeconds ?? null,
    maxPendingCount: tier.maxPendingCount ?? null,
  }
}

function isPendingExecutionPayload(
  value: unknown,
): value is PendingExecutionPayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export async function enqueuePendingExecution(
  params: PendingExecutionInsert,
): Promise<PendingExecutionHandle> {
  await ensureTriggerExecutionEnabled()
  let inserted = false

  const billingEnabled = await isBillingEnabledForRuntime()
  const billingContext = billingEnabled
    ? await resolveServerExecutionBillingContext({
        actorUserId: params.userId,
        workflowId: params.workflowId,
        workspaceId: params.workspaceId,
        requestId: params.requestId,
        source: params.source,
      })
    : null
  const billingScopeId = billingContext
    ? billingContext.scopeId
    : (params.workspaceId ?? params.userId)
  const billingScopeType = billingContext
    ? billingContext.scopeType
    : (params.workspaceId ? 'workspace' : 'user')
  const limits = billingContext
    ? getTierPendingExecutionLimits(billingContext.tier)
    : {
        maxPendingAgeSeconds: null,
        maxPendingCount: null,
      }

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${billingScopeId}))`,
    )

    if (limits.maxPendingAgeSeconds !== null) {
      const staleBefore = new Date(
        Date.now() - limits.maxPendingAgeSeconds * 1000,
      )

      await tx
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            eq(pendingExecution.status, 'pending'),
            lte(pendingExecution.createdAt, staleBefore),
          ),
        )

      await tx
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            inArray(pendingExecution.status, ['completed', 'failed']),
            lte(pendingExecution.completedAt, staleBefore),
          ),
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

    if (limits.maxPendingCount !== null) {
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            eq(pendingExecution.status, 'pending'),
          ),
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

  try {
    await tasks.trigger(PENDING_EXECUTION_DRAIN_TASK_ID, {
      billingScopeId,
    })
  } catch (error) {
    if (inserted) {
      await db
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.id, params.pendingExecutionId),
            eq(pendingExecution.status, 'pending'),
          ),
        )
    }
    throw error
  }

  return {
    pendingExecutionId: params.pendingExecutionId,
    billingScopeId,
  }
}

export async function claimNextPendingExecution(
  billingScopeId: string,
): Promise<PendingExecutionClaim | null> {
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS)

  await db
    .update(pendingExecution)
    .set({
      status: 'pending',
      processingStartedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pendingExecution.billingScopeId, billingScopeId),
        eq(pendingExecution.status, 'processing'),
        lte(pendingExecution.processingStartedAt, staleBefore),
      ),
    )

  for (let attempt = 0; attempt < CLAIM_ATTEMPT_LIMIT; attempt += 1) {
    const [candidate] = await db
      .select()
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.billingScopeId, billingScopeId),
          eq(pendingExecution.status, 'pending'),
          lte(pendingExecution.nextAttemptAt, new Date()),
          sql<boolean>`
            ${pendingExecution.orderingKey} is null
            or not exists (
              select 1
              from pending_execution blocked
              where blocked.billing_scope_id = ${pendingExecution.billingScopeId}
                and blocked.ordering_key = ${pendingExecution.orderingKey}
                and blocked.status in ('pending', 'processing')
                and (
                  blocked.created_at < ${pendingExecution.createdAt}
                  or (
                    blocked.created_at = ${pendingExecution.createdAt}
                    and blocked.id < ${pendingExecution.id}
                  )
                )
            )
          `,
        ),
      )
      .orderBy(
        asc(pendingExecution.nextAttemptAt),
        asc(pendingExecution.createdAt),
        asc(pendingExecution.id),
      )
      .limit(1)

    if (!candidate) {
      return null
    }

    const [claimed] = await db
      .update(pendingExecution)
      .set({
        status: 'processing',
        processingStartedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingExecution.id, candidate.id),
          eq(pendingExecution.status, 'pending'),
        ),
      )
      .returning()

    if (!claimed) {
      continue
    }

    if (!isPendingExecutionPayload(claimed.payload)) {
      return {
        ...claimed,
        payload: {},
      }
    }

    return claimed as PendingExecutionClaim
  }

  return null
}

export async function retryPendingExecution(params: {
  pendingExecutionId: string
  errorMessage: string
  delayMs: number
}) {
  await db
    .update(pendingExecution)
    .set({
      status: 'pending',
      attempts: sql`${pendingExecution.attempts} + 1`,
      nextAttemptAt: new Date(Date.now() + params.delayMs),
      processingStartedAt: null,
      errorMessage: params.errorMessage,
      updatedAt: new Date(),
    })
    .where(eq(pendingExecution.id, params.pendingExecutionId))
}

export async function failPendingExecution(params: {
  pendingExecutionId: string
  errorMessage: string
}) {
  await db
    .update(pendingExecution)
    .set({
      status: 'failed',
      attempts: sql`${pendingExecution.attempts} + 1`,
      processingStartedAt: null,
      errorMessage: params.errorMessage,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pendingExecution.id, params.pendingExecutionId))
}

export async function completePendingExecution(params: {
  pendingExecutionId: string
  result?: Record<string, unknown> | null
  deleteOnSuccess?: boolean
}) {
  if (params.deleteOnSuccess ?? true) {
    await db
      .delete(pendingExecution)
      .where(eq(pendingExecution.id, params.pendingExecutionId))
    return
  }

  await db
    .update(pendingExecution)
    .set({
      status: 'completed',
      errorMessage: null,
      result: params.result ?? null,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pendingExecution.id, params.pendingExecutionId))
}
