import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { ApiError, idempotencyKeys, runs, tasks, timeout } from '@trigger.dev/sdk'
import { and, asc, eq, lte, sql } from 'drizzle-orm'
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
export const PENDING_EXECUTION_TIME_LIMIT_ERROR = 'Workflow execution time limit exceeded'
const CANCELLATION_ERROR = 'Workflow execution was cancelled'
const EXPIRED_ERROR = 'Workflow execution expired before it started'
const MAX_WAKE_DISPATCHES = 20
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

type PendingExecutionClaimResult =
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

function getTierPendingExecutionLimits(tier: BillingTierRecord) {
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

async function hasWorkflowExecutionLog(
  store: Pick<typeof db, 'select'>,
  params: PendingExecutionInsert
) {
  if (params.executionType !== 'workflow') return false
  const [log] = await store
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, params.pendingExecutionId))
    .limit(1)
  return Boolean(log)
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

export function isTerminalPendingExecutionRunStatus(status: string) {
  return (
    status === 'COMPLETED' ||
    status === 'CANCELED' ||
    status === 'FAILED' ||
    status === 'CRASHED' ||
    status === 'SYSTEM_FAILURE' ||
    status === 'EXPIRED' ||
    status === 'TIMED_OUT'
  )
}

async function triggerPendingExecution(row: PendingExecutionClaim) {
  let admissionStarted = false
  try {
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

    admissionStarted = true
    await tasks.trigger(
      PENDING_EXECUTION_TASK_ID,
      {
        pendingExecutionId: row.id,
        ...(maxDuration === undefined ? {} : { executionMaxDuration: maxDuration }),
      },
      {
        idempotencyKey,
        tags: [triggerKey],
      }
    )
  } catch (error) {
    const admissionRejected =
      error instanceof ApiError &&
      (error.status === 400 ||
        error.status === 401 ||
        error.status === 403 ||
        error.status === 404 ||
        error.status === 422 ||
        error.status === 429)
    if (!admissionStarted || admissionRejected) {
      await db
        .update(pendingExecution)
        .set({
          status: 'pending',
          processingStartedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
    }
    throw error
  }
}

export async function dispatchNextPendingExecution(params: {
  billingScopeId: string
  billingScopeType: string
  triggerState?: TriggerExecutionState
}) {
  const triggerState = params.triggerState ?? (await getTriggerExecutionState())

  if (triggerState.mode === 'unavailable') {
    throw new TriggerExecutionUnavailableError()
  }

  if (triggerState.mode === 'local') {
    return { status: 'empty' as const }
  }

  let claim = await claimNextPendingExecution(params.billingScopeId, params.billingScopeType)
  if (claim.status === 'capacity_blocked') {
    await reconcilePendingExecutionCapacity(params.billingScopeId)
    claim = await claimNextPendingExecution(params.billingScopeId, params.billingScopeType)
  }
  if (claim.status !== 'claimed') {
    return claim
  }

  try {
    await triggerPendingExecution(claim.row)
  } catch (error) {
    const processing = await getProcessingPendingExecution(claim.row.id)
    if (!processing) throw error
    await reconcileProcessingPendingExecution(processing, processing.id)
  }

  return { status: 'dispatched' as const, pendingExecutionId: claim.row.id }
}

export async function wakePendingExecution(params: {
  billingScopeId: string
  billingScopeType: string
  requestId?: string
}) {
  try {
    const triggerState = await getTriggerExecutionState()

    for (let dispatchCount = 0; dispatchCount < MAX_WAKE_DISPATCHES; dispatchCount += 1) {
      const result = await dispatchNextPendingExecution({
        billingScopeId: params.billingScopeId,
        billingScopeType: params.billingScopeType,
        triggerState,
      })
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
    throw error
  }
}

export async function enqueuePendingExecution(
  params: PendingExecutionInsert
): Promise<PendingExecutionHandle> {
  const initialTriggerState = await getTriggerExecutionState()
  if (initialTriggerState.mode === 'unavailable') {
    throw new TriggerExecutionUnavailableError()
  }
  const billingContext =
    initialTriggerState.mode === 'trigger'
      ? await resolveServerExecutionBillingContext({
          actorUserId: params.userId,
          workflowId: params.workflowId,
          workspaceId: params.workspaceId,
          requestId: params.requestId,
          source: params.source,
        })
      : null

  const queueResult = await db.transaction(async (tx) => {
    await lockPendingExecutionMode(tx)
    const triggerState = await getTriggerExecutionState(tx)
    if (triggerState.mode === 'unavailable') {
      throw new TriggerExecutionUnavailableError()
    }
    if (triggerState.mode !== initialTriggerState.mode) {
      throw new TriggerExecutionUnavailableError(
        'Execution mode changed during admission. Retry the request.'
      )
    }
    const execution = {
      id: params.pendingExecutionId,
      executionType: params.executionType,
      orderingKey: params.orderingKey ?? null,
      source: params.source,
      userId: params.userId,
      workflowId: params.workflowId ?? null,
      workspaceId: params.workspaceId ?? null,
      payload: params.payload,
    }
    if (triggerState.mode === 'local') {
      if (await hasWorkflowExecutionLog(tx, params)) {
        return { mode: 'local' as const, inserted: false }
      }
      const [inserted] = await tx
        .insert(pendingExecution)
        .values({
          ...execution,
          billingScopeId: params.workspaceId ?? params.userId,
          billingScopeType: 'local',
          status: 'processing',
          processingStartedAt: new Date(),
        })
        .onConflictDoNothing({ target: pendingExecution.id })
        .returning({ id: pendingExecution.id })
      return { mode: 'local' as const, inserted: Boolean(inserted) }
    }

    const billingScopeId = billingContext ? billingContext.scopeId : params.userId
    const billingScopeType = billingContext ? billingContext.scopeType : 'user'
    const limits = billingContext
      ? getTierPendingExecutionLimits(billingContext.tier)
      : {
          maxPendingAgeSeconds: null,
          maxPendingCount: null,
        }
    const queueResult = (inserted: boolean) => ({
      mode: 'trigger' as const,
      billingScopeId,
      billingScopeType,
      inserted,
      triggerState,
    })

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
      return queueResult(false)
    }

    if (await hasWorkflowExecutionLog(tx, params)) {
      return queueResult(false)
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
        return queueResult(false)
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
      ...execution,
      billingScopeId,
      billingScopeType,
    })
    return queueResult(true)
  })

  if (queueResult.mode === 'local') {
    if (queueResult.inserted) startLocalPendingExecution(params)
    return {
      pendingExecutionId: params.pendingExecutionId,
      inserted: queueResult.inserted,
    }
  }

  const { billingScopeId, billingScopeType, inserted, triggerState } = queueResult

  if (!inserted) {
    const processing = await getProcessingPendingExecution(params.pendingExecutionId)
    if (processing)
      await reconcilePendingExecutionCapacity(processing.billingScopeId, processing.id)
    await wakePendingExecution({ billingScopeId, billingScopeType, requestId: params.requestId })
    return {
      pendingExecutionId: params.pendingExecutionId,
      inserted,
    }
  }

  await dispatchNextPendingExecution({
    billingScopeId,
    billingScopeType,
    triggerState,
  })

  return {
    pendingExecutionId: params.pendingExecutionId,
    inserted,
  }
}

function startLocalPendingExecution(params: PendingExecutionInsert) {
  const startedAt = Date.now()
  void import('@/background/pending-execution-job')
    .then(({ executePendingExecutionJob }) =>
      executePendingExecutionJob(
        {
          id: params.pendingExecutionId,
          executionType: params.executionType,
          payload: params.payload,
        },
        { triggerRuntime: false }
      )
    )
    .then(
      () =>
        completePendingExecution({
          pendingExecutionId: params.pendingExecutionId,
          wake: false,
        }),
      async (error) => {
        logger.error('Local pending execution failed', {
          pendingExecutionId: params.pendingExecutionId,
          error,
        })
        const row = await getProcessingPendingExecution(params.pendingExecutionId)
        if (!row) return
        const { finalizePendingExecutionFailure, PENDING_EXECUTION_WORKER_FAILURE_ERROR } =
          await import('@/background/pending-execution-worker')
        const message =
          error instanceof Error ? error.message : PENDING_EXECUTION_WORKER_FAILURE_ERROR
        await finalizePendingExecutionFailure(row, message, Math.max(1, Date.now() - startedAt), {
          wake: false,
        })
      }
    )
    .catch((error) => {
      logger.error('Local pending execution lifecycle cleanup failed', {
        pendingExecutionId: params.pendingExecutionId,
        error,
      })
    })
}

export async function claimNextPendingExecution(
  billingScopeId: string,
  billingScopeType: string
): Promise<PendingExecutionClaimResult> {
  const concurrencyLimit = await getConcurrencyLimitForPendingExecution({
    billingScopeId,
    billingScopeType,
  })
  return db.transaction((tx) =>
    claimNextPendingExecutionWithStore(billingScopeId, concurrencyLimit, tx)
  )
}

async function claimNextPendingExecutionWithStore(
  billingScopeId: string,
  concurrencyLimit: number | null,
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

async function listProcessingPendingExecutionsForBillingScope(billingScopeId: string) {
  const rows = await db
    .select()
    .from(pendingExecution)
    .where(
      and(
        eq(pendingExecution.billingScopeId, billingScopeId),
        eq(pendingExecution.status, 'processing')
      )
    )
    .orderBy(asc(pendingExecution.createdAt), asc(pendingExecution.id))

  return rows.map(asPendingExecutionClaim)
}

function getPendingExecutionCapacityOwnerId(
  row: PendingExecutionClaim,
  activeRowsById: ReadonlyMap<string, PendingExecutionClaim>
) {
  let owner = row
  const visited = new Set([row.id])
  let parentExecutionId = getParentExecutionId(owner)

  while (parentExecutionId) {
    const parent = activeRowsById.get(parentExecutionId)
    if (!parent || visited.has(parent.id)) break
    owner = parent
    visited.add(parent.id)
    parentExecutionId = getParentExecutionId(parent)
  }

  return owner.id
}

async function releasedPendingExecutionCapacity(capacityOwnerId: string) {
  return (await getProcessingPendingExecution(capacityOwnerId)) === null
}

async function reconcileProcessingPendingExecution(
  row: PendingExecutionClaim,
  capacityOwnerId: string
) {
  const page = await runs.list({
    tag: getPendingExecutionTriggerKey(row.id),
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]

  if (!run) {
    await triggerPendingExecution(row)
    return false
  }
  if (!isTerminalPendingExecutionRunStatus(run.status)) return false

  if (run.status === 'COMPLETED') {
    if ((await listChildPendingWorkflowExecutions(row.id)).length > 0) {
      await markPendingExecutionOwnerCompleted(row, { wake: false })
      return releasedPendingExecutionCapacity(capacityOwnerId)
    }
    await completePendingExecution({ pendingExecutionId: row.id, wake: false })
    return releasedPendingExecutionCapacity(capacityOwnerId)
  }

  const { finalizePendingExecutionFailure, PENDING_EXECUTION_WORKER_FAILURE_ERROR } = await import(
    '@/background/pending-execution-worker'
  )
  const message =
    run.status === 'EXPIRED'
      ? EXPIRED_ERROR
      : run.status === 'CANCELED'
        ? CANCELLATION_ERROR
        : PENDING_EXECUTION_WORKER_FAILURE_ERROR
  await finalizePendingExecutionFailure(row, message, run.durationMs, {
    wake: false,
  })
  return releasedPendingExecutionCapacity(capacityOwnerId)
}

async function reconcilePendingExecutionCapacity(
  billingScopeId: string,
  preferredPendingExecutionId?: string
) {
  let rows: PendingExecutionClaim[]
  try {
    rows = await listProcessingPendingExecutionsForBillingScope(billingScopeId)
  } catch (error) {
    logger.error('Pending execution capacity reconciliation failed', { billingScopeId, error })
    return
  }
  rows.sort(
    (left, right) =>
      Number(right.id === preferredPendingExecutionId) -
      Number(left.id === preferredPendingExecutionId)
  )

  const activeRowsById = new Map(rows.map((row) => [row.id, row]))
  for (const row of rows) {
    try {
      const capacityOwnerId = getPendingExecutionCapacityOwnerId(row, activeRowsById)
      if (await reconcileProcessingPendingExecution(row, capacityOwnerId)) return
    } catch (error) {
      logger.error('Pending execution capacity reconciliation failed', {
        billingScopeId,
        pendingExecutionId: row.id,
        error,
      })
    }
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

export async function markPendingExecutionOwnerCompleted(
  row: Pick<PendingExecutionClaim, 'id'>,
  options: { wake?: boolean } = {}
) {
  const ownerCompletedAt = new Date().toISOString()
  await db
    .update(pendingExecution)
    .set({
      payload: sql`${pendingExecution.payload} || jsonb_build_object('ownerCompletedAt', ${ownerCompletedAt})`,
      updatedAt: new Date(),
    })
    .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))

  await completeOwnerWithoutChildren(row.id, options)
}

function asPendingExecutionClaim(row: typeof pendingExecution.$inferSelect): PendingExecutionClaim {
  return {
    ...row,
    payload: isPendingExecutionPayload(row.payload) ? row.payload : {},
  } as PendingExecutionClaim
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

export async function completePendingExecution(params: {
  pendingExecutionId: string
  wake?: boolean
}) {
  // The queue row is the active capacity marker; terminal state belongs to the execution owner.
  const [deleted] = await db
    .delete(pendingExecution)
    .where(eq(pendingExecution.id, params.pendingExecutionId))
    .returning({
      billingScopeId: pendingExecution.billingScopeId,
      billingScopeType: pendingExecution.billingScopeType,
      parentExecutionId: sql<
        string | null
      >`case when ${pendingExecution.source} = ${WORKFLOW_BLOCK_SOURCE} then ${pendingExecution.payload}->'metadata'->>'parentExecutionId' else null end`,
    })

  if (deleted?.billingScopeId && params.wake !== false) {
    await wakePendingExecution({
      billingScopeId: deleted.billingScopeId,
      billingScopeType: deleted.billingScopeType,
    })
  }

  if (deleted?.parentExecutionId) {
    await completeOwnerWithoutChildren(deleted.parentExecutionId, { wake: params.wake })
  }
}

async function completeOwnerWithoutChildren(
  pendingExecutionId: string,
  options: { wake?: boolean } = {}
) {
  const owner = await getProcessingPendingExecution(pendingExecutionId)
  if (typeof owner?.payload.ownerCompletedAt !== 'string') return
  if ((await listChildPendingWorkflowExecutions(pendingExecutionId)).length > 0) return
  await completePendingExecution({ pendingExecutionId, wake: options.wake })
}
