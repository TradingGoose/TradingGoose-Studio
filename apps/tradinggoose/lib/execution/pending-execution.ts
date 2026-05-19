import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, asc, eq, lte, ne, sql } from 'drizzle-orm'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { isDev } from '@/lib/environment'
import {
  resolveServerExecutionBillingContext,
  resolveServerExecutionBillingTierForScope,
} from '@/lib/execution/execution-concurrency-limit'
import {
  triggerPendingExecutionDrain,
  wakePendingExecutionDrain,
} from '@/lib/execution/pending-execution-drain-wake'
import { getTriggerExecutionState, TriggerExecutionUnavailableError } from '@/lib/trigger/settings'

export {
  PENDING_EXECUTION_DRAIN_TASK_ID,
  triggerPendingExecutionDrain,
} from '@/lib/execution/pending-execution-drain-wake'

const STALE_PROCESSING_WINDOW_MS = 30 * 60 * 1000
const PENDING_EXECUTION_LOCK_NAMESPACE = 29_401
const WORKFLOW_BLOCK_SOURCE = 'workflow_block'

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
  inserted: boolean
}

type PendingExecutionRow = {
  id: string
  billingScopeId: string
  billingScopeType: string
  executionType: string
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

export type PendingExecutionCancellationResult = { status: 'not_found' } | { status: 'cancelling' }

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
  if (limit === null || limit < 0) {
    throw new Error(`Billing tier ${tier.displayName} is missing concurrencyLimit`)
  }

  return limit
}

function isPendingExecutionPayload(value: unknown): value is PendingExecutionPayload {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

// Workflow-block children are queued for durability, but capacity is held by the parent workflow.
const usesParentExecutionCapacity = (row: Pick<PendingExecutionRow, 'source'>) =>
  row.source === WORKFLOW_BLOCK_SOURCE

export async function enqueuePendingExecution(
  params: PendingExecutionInsert
): Promise<PendingExecutionHandle> {
  const triggerState = await getTriggerExecutionState()

  if (triggerState.triggerDevEnabled && !triggerState.configurationReady) {
    throw new TriggerExecutionUnavailableError(
      'Trigger.dev execution is enabled but not configured.'
    )
  }

  if (!triggerState.executionEnabled && (triggerState.triggerDevEnabled || !isDev)) {
    throw new TriggerExecutionUnavailableError(
      'Queued server execution requires Trigger.dev outside local development.'
    )
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
      await triggerPendingExecutionDrain({
        billingScopeId,
        requestId: params.requestId,
        triggerState,
      })
    }
    return {
      pendingExecutionId: params.pendingExecutionId,
      billingScopeId,
      inserted,
    }
  }

  try {
    await triggerPendingExecutionDrain({
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
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_WINDOW_MS)
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${billingScopeId}))`
    )

    await tx
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
      return { status: 'empty' }
    }

    if (!isPendingExecutionPayload(claimed.payload)) {
      return {
        status: 'claimed',
        row: {
          ...claimed,
          payload: {},
        },
      }
    }

    return { status: 'claimed', row: claimed as PendingExecutionClaim }
  })
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
      payload: pendingExecution.payload,
    })
    .from(pendingExecution)
    .where(eq(pendingExecution.id, pendingExecutionId))
    .limit(1)

  if (!row) return false

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

    const cancelledAt = new Date().toISOString()
    const payload = withCancellationRequest(row.payload, cancelledAt)

    const cancellingRows = await db
      .update(pendingExecution)
      .set({
        payload,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingExecution.id, row.id),
          row.status === 'pending'
            ? eq(pendingExecution.status, 'pending')
            : eq(pendingExecution.status, 'processing')
        )
      )
      .returning({ id: pendingExecution.id })

    if (cancellingRows.length > 0) {
      return { status: 'cancelling' }
    }
  }

  return { status: 'not_found' }
}

export async function completePendingExecution(params: { pendingExecutionId: string }) {
  // The queue row is the active capacity marker; terminal state belongs to the execution owner.
  const [deleted] = await db
    .delete(pendingExecution)
    .where(eq(pendingExecution.id, params.pendingExecutionId))
    .returning({ billingScopeId: pendingExecution.billingScopeId })

  if (deleted?.billingScopeId) {
    await wakePendingExecutionDrain({
      billingScopeId: deleted.billingScopeId,
    })
  }
}
