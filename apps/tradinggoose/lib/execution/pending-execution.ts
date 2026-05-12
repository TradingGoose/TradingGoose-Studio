import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { tasks } from '@trigger.dev/sdk'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { isBillingEnabledForRuntime } from '@/lib/billing/settings'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { resolveServerExecutionBillingContext } from '@/lib/execution/execution-concurrency-limit'
import { appendWorkflowExecutionEventToPayload } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState } from '@/lib/trigger/settings'

export const PENDING_EXECUTION_DRAIN_TASK_ID = 'pending-execution-drain'
export const PENDING_EXECUTION_RETRY_DELAY_MS = 15_000
export const WORKFLOW_EXECUTION_CANCELLED_ERROR = 'Workflow execution was cancelled'

const CLAIM_ATTEMPT_LIMIT = 5
const STALE_PROCESSING_WINDOW_MS = 30 * 60 * 1000
const PENDING_EXECUTION_LOCK_NAMESPACE = 29_401
const logger = createLogger('PendingExecutionQueue')

let warnedLocalExecution = false

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

export type PendingWorkflowExecutionAccessContext = {
  id: string
  userId: string
  workflowId: string
  workspaceId: string | null
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

export type PendingExecutionCancellationResult =
  | { status: 'not_found' }
  | { status: 'cancelled' }
  | { status: 'cancelling' }
  | { status: 'finished' }

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

export async function readPendingWorkflowExecutionAccessContext(params: {
  pendingExecutionId: string
  workflowId: string
}): Promise<PendingWorkflowExecutionAccessContext | null> {
  const [row] = await db
    .select({
      id: pendingExecution.id,
      userId: pendingExecution.userId,
      workflowId: pendingExecution.workflowId,
      workspaceId: pendingExecution.workspaceId,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.workflowId, params.workflowId),
        eq(pendingExecution.executionType, 'workflow')
      )
    )
    .limit(1)

  if (!row?.workflowId) return null

  return {
    id: row.id,
    userId: row.userId,
    workflowId: row.workflowId,
    workspaceId: row.workspaceId,
  }
}

function isPendingExecutionPayload(value: unknown): value is PendingExecutionPayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export async function enqueuePendingExecution(
  params: PendingExecutionInsert
): Promise<PendingExecutionHandle> {
  const triggerState = await getTriggerExecutionState()
  const useTriggerDev = triggerState.executionEnabled
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
    : params.workspaceId
      ? 'workspace'
      : 'user'
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

      await tx
        .delete(pendingExecution)
        .where(
          and(
            eq(pendingExecution.billingScopeId, billingScopeId),
            inArray(pendingExecution.status, ['completed', 'failed']),
            lte(pendingExecution.completedAt, staleBefore)
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

  if (useTriggerDev) {
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
              eq(pendingExecution.status, 'pending')
            )
          )
      }
      throw error
    }
  } else {
    if (!triggerState.configurationReady && !warnedLocalExecution) {
      warnedLocalExecution = true
      logger.warn('Trigger.dev is not configured; draining pending executions locally.')
    }

    const { drainPendingExecutionsForBillingScope } = await import(
      '@/background/pending-execution-drain'
    )

    await drainPendingExecutionsForBillingScope({
      billingScopeId,
    })
  }

  return {
    pendingExecutionId: params.pendingExecutionId,
    billingScopeId,
  }
}

export async function claimNextPendingExecution(
  billingScopeId: string
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
        lte(pendingExecution.processingStartedAt, staleBefore)
      )
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
          `
        )
      )
      .orderBy(
        asc(pendingExecution.nextAttemptAt),
        asc(pendingExecution.createdAt),
        asc(pendingExecution.id)
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
      .where(and(eq(pendingExecution.id, candidate.id), eq(pendingExecution.status, 'pending')))
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

function withCancellationRequest(payload: unknown, cancelledAt: string): PendingExecutionPayload {
  return {
    ...(isPendingExecutionPayload(payload) ? payload : {}),
    cancelRequestedAt: cancelledAt,
  }
}

export async function isPendingWorkflowExecutionCancellationRequested(pendingExecutionId: string) {
  const [row] = await db
    .select({
      status: pendingExecution.status,
      payload: pendingExecution.payload,
      errorMessage: pendingExecution.errorMessage,
    })
    .from(pendingExecution)
    .where(eq(pendingExecution.id, pendingExecutionId))
    .limit(1)

  if (!row) return false
  if (row.status === 'failed' && row.errorMessage === WORKFLOW_EXECUTION_CANCELLED_ERROR) {
    return true
  }

  const payload = isPendingExecutionPayload(row.payload) ? row.payload : {}
  return typeof payload.cancelRequestedAt === 'string'
}

export async function cancelPendingWorkflowExecution(params: {
  pendingExecutionId: string
  userId: string
}): Promise<PendingExecutionCancellationResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [row] = await db
      .select({
        id: pendingExecution.id,
        status: pendingExecution.status,
        payload: pendingExecution.payload,
        workflowId: pendingExecution.workflowId,
      })
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.id, params.pendingExecutionId),
          eq(pendingExecution.userId, params.userId),
          eq(pendingExecution.executionType, 'workflow')
        )
      )
      .limit(1)

    if (!row || !row.workflowId) {
      return { status: 'not_found' }
    }

    if (row.status === 'completed' || row.status === 'failed') {
      return { status: 'finished' }
    }

    const cancelledAt = new Date().toISOString()
    const payload = withCancellationRequest(row.payload, cancelledAt)

    if (row.status === 'pending') {
      const result = {
        success: false,
        output: {},
        error: WORKFLOW_EXECUTION_CANCELLED_ERROR,
        logs: [],
        workflowId: row.workflowId,
        executionId: row.id,
        executedAt: cancelledAt,
      }
      const { payload: cancelledPayload } = appendWorkflowExecutionEventToPayload({
        payload,
        pendingExecutionId: row.id,
        workflowId: row.workflowId,
        input: {
          type: 'execution:cancelled',
          timestamp: cancelledAt,
          data: { result },
        },
      })

      const cancelledRows = await db
        .update(pendingExecution)
        .set({
          status: 'failed',
          payload: cancelledPayload,
          errorMessage: WORKFLOW_EXECUTION_CANCELLED_ERROR,
          result,
          processingStartedAt: null,
          completedAt: new Date(cancelledAt),
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'pending')))
        .returning({ id: pendingExecution.id })

      if (cancelledRows.length > 0) {
        return { status: 'cancelled' }
      }
      continue
    }

    const cancellingRows = await db
      .update(pendingExecution)
      .set({
        payload,
        errorMessage: WORKFLOW_EXECUTION_CANCELLED_ERROR,
        updatedAt: new Date(),
      })
      .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
      .returning({ id: pendingExecution.id })

    if (cancellingRows.length > 0) {
      return { status: 'cancelling' }
    }
  }

  const [row] = await db
    .select({
      status: pendingExecution.status,
    })
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.id, params.pendingExecutionId),
        eq(pendingExecution.userId, params.userId),
        eq(pendingExecution.executionType, 'workflow')
      )
    )
    .limit(1)

  return row?.status === 'completed' || row?.status === 'failed'
    ? { status: 'finished' }
    : { status: 'not_found' }
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
    await db.delete(pendingExecution).where(eq(pendingExecution.id, params.pendingExecutionId))
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
