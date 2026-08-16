import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { idempotencyKeys, tasks, timeout } from '@trigger.dev/sdk'
import { and, asc, eq, gt, lte, sql } from 'drizzle-orm'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import {
  resolveServerExecutionBillingContext,
  resolveServerExecutionBillingTierForScope,
} from '@/lib/execution/execution-concurrency-limit'
import { lockPendingExecutionMode } from '@/lib/execution/execution-mode-lock'
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

function getParentExecutionId(row: Pick<PendingExecutionRow, 'payload' | 'source'>) {
  if (row.source !== WORKFLOW_BLOCK_SOURCE || !isPendingExecutionPayload(row.payload)) return null
  const metadata = row.payload.metadata
  if (!isPendingExecutionPayload(metadata)) return null
  return typeof metadata.parentExecutionId === 'string' && metadata.parentExecutionId.length > 0
    ? metadata.parentExecutionId
    : null
}

// A child borrows capacity only while its parent is a processing row in the same billing scope.
const usesParentExecutionCapacity = (
  row: Pick<PendingExecutionRow, 'payload' | 'source'>,
  activeExecutionIds: ReadonlySet<string>
) => {
  const parentExecutionId = getParentExecutionId(row)
  return parentExecutionId !== null && activeExecutionIds.has(parentExecutionId)
}

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
    return { status: 'empty' as const }
  }

  const claim = await claimNextPendingExecution(params.billingScopeId)
  if (claim.status !== 'claimed') {
    return claim
  }

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
  const queueResult = await db.transaction(async (tx) => {
    await lockPendingExecutionMode(tx)
    const triggerState = await getTriggerExecutionState(tx)
    if (triggerState.mode === 'unavailable') {
      throw new TriggerExecutionUnavailableError()
    }
    if (triggerState.mode === 'local') {
      return { mode: 'local' as const }
    }

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
      return { mode: 'trigger' as const, billingScopeId, inserted: false, triggerState }
    }

    if (params.executionType === 'workflow') {
      const [existingLog] = await tx
        .select({ id: workflowExecutionLogs.id })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, params.pendingExecutionId))
        .limit(1)

      if (existingLog) {
        return { mode: 'trigger' as const, billingScopeId, inserted: false, triggerState }
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
        return { mode: 'trigger' as const, billingScopeId, inserted: false, triggerState }
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
    return { mode: 'trigger' as const, billingScopeId, inserted: true, triggerState }
  })

  if (queueResult.mode === 'local') {
    return executeLocalPendingExecution(params)
  }

  const { billingScopeId, inserted, triggerState } = queueResult

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

  await dispatchNextPendingExecution({
    billingScopeId,
    requestId: params.requestId,
    triggerState,
  })

  return {
    pendingExecutionId: params.pendingExecutionId,
    billingScopeId,
    inserted,
  }
}

async function executeLocalPendingExecution(
  params: PendingExecutionInsert
): Promise<PendingExecutionHandle> {
  const { executePendingExecutionJob } = await import('@/background/pending-execution-job')
  await executePendingExecutionJob(
    {
      id: params.pendingExecutionId,
      executionType: params.executionType,
      payload: params.payload,
    },
    { triggerRuntime: false }
  )

  return {
    pendingExecutionId: params.pendingExecutionId,
    billingScopeId: params.userId,
    inserted: true,
  }
}

export async function claimNextPendingExecution(
  billingScopeId: string
): Promise<PendingExecutionClaimResult> {
  return db.transaction((tx) => claimNextPendingExecutionWithStore(billingScopeId, tx))
}

async function claimNextPendingExecutionWithStore(
  billingScopeId: string,
  store: Pick<typeof db, 'execute' | 'select' | 'update'>
): Promise<PendingExecutionClaimResult> {
  await store.execute(
    sql`select pg_advisory_xact_lock(${PENDING_EXECUTION_LOCK_NAMESPACE}, hashtext(${billingScopeId}))`
  )

  const [candidate] = await store
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
      sql`case when ${pendingExecution.source} = ${WORKFLOW_BLOCK_SOURCE} and exists (
        select 1 from ${pendingExecution} as "parent_pending_execution"
        where "parent_pending_execution"."id" = ${pendingExecution.payload}->'metadata'->>'parentExecutionId'
          and "parent_pending_execution"."billing_scope_id" = ${billingScopeId}
          and "parent_pending_execution"."status" = 'processing'
      ) then 0 when ${pendingExecution.source} = ${WORKFLOW_BLOCK_SOURCE} then 1 else 2 end`,
      asc(pendingExecution.nextAttemptAt),
      asc(pendingExecution.createdAt),
      asc(pendingExecution.id)
    )
    .limit(1)

  if (!candidate) {
    return { status: 'empty' }
  }

  const concurrencyLimit = await getConcurrencyLimitForPendingExecution(candidate)
  if (concurrencyLimit !== null) {
    const activeRows = await store
      .select({
        id: pendingExecution.id,
        payload: pendingExecution.payload,
        source: pendingExecution.source,
      })
      .from(pendingExecution)
      .where(
        and(
          eq(pendingExecution.billingScopeId, billingScopeId),
          eq(pendingExecution.status, 'processing')
        )
      )
      .execute()
    const activeExecutionIds = new Set(activeRows.map((row) => row.id))

    if (!usesParentExecutionCapacity(candidate, activeExecutionIds)) {
      const activeCount = activeRows.filter(
        (row) => !usesParentExecutionCapacity(row, activeExecutionIds)
      ).length
      if (activeCount >= concurrencyLimit) {
        return { status: 'capacity_blocked', pendingExecutionId: candidate.id }
      }
    }
  }

  const [claimed] = await store
    .update(pendingExecution)
    .set({
      status: 'processing',
      processingStartedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(pendingExecution.id, candidate.id), eq(pendingExecution.status, 'pending')))
    .returning()

  if (!claimed) {
    throw new Error(`Pending execution ${candidate.id} could not be claimed`)
  }

  return { status: 'claimed', row: asPendingExecutionClaim(claimed) }
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

export async function markPendingExecutionOwnerCompleted(row: PendingExecutionClaim) {
  const ownerCompletedAt = new Date().toISOString()
  await db
    .update(pendingExecution)
    .set({
      payload: sql`${pendingExecution.payload} || jsonb_build_object('ownerCompletedAt', ${ownerCompletedAt})`,
      updatedAt: new Date(),
    })
    .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))

  await completeOwnerWithoutChildren(row.id)
}

function asPendingExecutionClaim(row: typeof pendingExecution.$inferSelect): PendingExecutionClaim {
  return {
    ...row,
    payload: isPendingExecutionPayload(row.payload) ? row.payload : {},
  } as PendingExecutionClaim
}

export async function listProcessingPendingExecutions(params: { afterId?: string; limit: number }) {
  return db.transaction(async (tx) => {
    await lockPendingExecutionMode(tx)
    if ((await getTriggerExecutionState(tx)).mode !== 'trigger') return null

    const rows = await tx
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
  })
}

async function listPendingExecutionBillingScopesWithStore(
  params: {
    afterBillingScopeId?: string
    limit: number
  },
  store: Pick<typeof db, 'selectDistinct'>
) {
  return store
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

export async function listPendingExecutionBillingScopes(params: {
  afterBillingScopeId?: string
  limit: number
}) {
  return db.transaction(async (tx) => {
    await lockPendingExecutionMode(tx)
    if ((await getTriggerExecutionState(tx)).mode !== 'trigger') return null
    return listPendingExecutionBillingScopesWithStore(params, tx)
  })
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
    .returning({
      billingScopeId: pendingExecution.billingScopeId,
      parentExecutionId: sql<
        string | null
      >`case when ${pendingExecution.source} = ${WORKFLOW_BLOCK_SOURCE} then ${pendingExecution.payload}->'metadata'->>'parentExecutionId' else null end`,
    })

  if (deleted?.billingScopeId) {
    await wakePendingExecution({
      billingScopeId: deleted.billingScopeId,
    })
  }

  if (deleted?.parentExecutionId) {
    await completeOwnerWithoutChildren(deleted.parentExecutionId)
  }
}

async function completeOwnerWithoutChildren(pendingExecutionId: string) {
  const owner = await getProcessingPendingExecution(pendingExecutionId)
  if (typeof owner?.payload.ownerCompletedAt !== 'string') return
  if ((await listChildPendingWorkflowExecutions(pendingExecutionId)).length > 0) return
  await completePendingExecution({ pendingExecutionId })
}
