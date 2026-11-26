import { createHash } from 'node:crypto'
import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { ApiError, idempotencyKeys, runs, TriggerClient, tasks, timeout } from '@trigger.dev/sdk'
import { and, asc, eq, lte, ne, sql } from 'drizzle-orm'
import type { BillingTierRecord } from '@/lib/billing/tiers'
import { env } from '@/lib/env'
import {
  backgroundTaskIds,
  dispatchBackgroundExecution,
} from '@/lib/execution/background-execution'
import {
  resolveServerExecutionBillingContext,
  resolveServerExecutionBillingTierForScope,
} from '@/lib/execution/execution-concurrency-limit'
import { lockPendingExecutionMode } from '@/lib/execution/execution-mode-lock'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState, TriggerExecutionUnavailableError } from '@/lib/trigger/settings'

export const PENDING_EXECUTION_TASK_ID = 'pending-execution'
export const PENDING_EXECUTION_LOCK_NAMESPACE = 29_401
const WORKFLOW_WORKLOAD_LOCK_NAMESPACE = 29_405
const WORKFLOW_BLOCK_SOURCE = 'workflow_block'
export const PENDING_EXECUTION_TIME_LIMIT_ERROR = 'Workflow execution time limit exceeded'
export const PENDING_EXECUTION_CANCELLATION_ERROR = 'Workflow execution was cancelled'
export const PENDING_EXECUTION_FAILURE_ERROR = 'Workflow execution stopped before it could finish'
const EXPIRED_ERROR = 'Workflow execution expired before it started'
const MAX_WAKE_DISPATCHES = 20
const logger = createLogger('PendingExecutionQueue')
type TriggerExecutionState = Awaited<ReturnType<typeof getTriggerExecutionState>>

export type PendingExecutionType = 'workflow' | 'webhook' | 'schedule' | 'monitor' | 'document'

export type PendingExecutionPayload = Record<string, unknown>

export type PendingExecutionTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

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
  beforeEnqueue?: (tx: PendingExecutionTransaction) => Promise<boolean>
  afterInsert?: (tx: PendingExecutionTransaction) => Promise<void>
  /** Reserved for a validated checkpoint transition, never copied from request payloads. */
  continuation?: boolean
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

function getParentPendingExecutionId(row: Pick<PendingExecutionRow, 'payload' | 'source'>) {
  if (row.source !== WORKFLOW_BLOCK_SOURCE || !isPendingExecutionPayload(row.payload)) return null
  const metadata = row.payload.metadata
  if (!isPendingExecutionPayload(metadata)) return null
  return typeof metadata.parentPendingExecutionId === 'string' &&
    metadata.parentPendingExecutionId.length > 0
    ? metadata.parentPendingExecutionId
    : null
}

// A child borrows capacity only while its parent is a processing row in the same billing scope.
const usesParentExecutionCapacity = (
  row: Pick<PendingExecutionRow, 'payload' | 'source'>,
  activeExecutionIds: ReadonlySet<string>
) => {
  const parentPendingExecutionId = getParentPendingExecutionId(row)
  return parentPendingExecutionId !== null && activeExecutionIds.has(parentPendingExecutionId)
}

export function isWorkflowPendingExecution(
  row: Pick<PendingExecutionClaim, 'executionType' | 'source'>
) {
  return (
    row.executionType === 'workflow' ||
    row.executionType === 'webhook' ||
    row.executionType === 'schedule' ||
    (row.executionType === 'monitor' && row.source === 'monitor:portfolio')
  )
}

function getPendingExecutionTriggerKey(pendingExecutionId: string) {
  const digest = createHash('sha256').update(pendingExecutionId).digest('hex')
  return `${PENDING_EXECUTION_TASK_ID}:${digest}`
}

async function triggerPendingExecution(row: PendingExecutionClaim) {
  const startedAt = Date.now()
  let admissionStarted = false
  try {
    const triggerKey = getPendingExecutionTriggerKey(row.id)
    const idempotencyKey = await idempotencyKeys.create(triggerKey, { scope: 'global' })
    const tier = await resolveServerExecutionBillingTierForScope({
      scopeId: row.billingScopeId,
      scopeType: row.billingScopeType,
    })

    admissionStarted = true
    await tasks.trigger(
      PENDING_EXECUTION_TASK_ID,
      {
        pendingExecutionId: row.id,
        billingScopeId: row.billingScopeId,
        billingScopeType: row.billingScopeType,
        executionMaxDuration: tier?.workflowExecutionTimeLimitSeconds ?? timeout.None,
      },
      {
        idempotencyKey,
        tags: [triggerKey],
      }
    )
  } catch (error) {
    const status = error instanceof ApiError ? error.status : undefined
    const permanentAdmissionError =
      status === 400 || status === 401 || status === 403 || status === 404 || status === 422
    const retryableAdmissionError =
      status === 408 || status === 409 || status === 429 || (status !== undefined && status >= 500)

    if (permanentAdmissionError && error instanceof ApiError) {
      const { finalizePendingExecutionFailure } = await import(
        '@/background/pending-execution-worker'
      )
      try {
        const result = await finalizePendingExecutionFailure(
          row,
          error.message,
          Math.max(1, Date.now() - startedAt)
        )
        if (result === 'retired') return { status: 'retired' as const, error }
      } catch (finalizationError) {
        if (row.executionType === 'document')
          return { status: 'finalization_failed' as const, error: finalizationError }

        logger.error(
          'Permanent Trigger admission failure finalization failed',
          { pendingExecutionId: row.id, status: error.status, message: error.message },
          finalizationError
        )
      }
      throw error
    }

    if (!admissionStarted || status === 429) {
      await db
        .update(pendingExecution)
        .set({
          status: 'pending',
          processingStartedAt: null,
          updatedAt: new Date(),
        })
        .where(and(eq(pendingExecution.id, row.id), eq(pendingExecution.status, 'processing')))
    }
    if (retryableAdmissionError) {
      throw new TriggerExecutionUnavailableError(
        'Trigger.dev rejected execution admission. Retry the request.'
      )
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
  if (claim.status === 'capacity_blocked' || claim.status === 'empty') {
    const rejection = await reconcilePendingExecutionCapacity(params.billingScopeId)
    if (rejection) return rejection
    claim = await claimNextPendingExecution(params.billingScopeId, params.billingScopeType)
  }
  if (claim.status !== 'claimed') {
    return claim
  }

  let rejection
  try {
    rejection = await triggerPendingExecution(claim.row)
  } catch (error) {
    const processing = await getProcessingPendingExecution(claim.row.id)
    if (!processing) throw error
    const reconciled = await reconcileProcessingPendingExecution(processing, processing.id)
    if (typeof reconciled === 'object') return reconciled
  }

  if (rejection?.status === 'finalization_failed') throw rejection.error
  if (rejection) return rejection
  return { status: 'dispatched' as const, pendingExecutionId: claim.row.id }
}

export async function wakePendingExecution(params: {
  billingScopeId: string
  billingScopeType: string
  requestId?: string
}) {
  try {
    const triggerState = await getTriggerExecutionState()

    let rejection
    for (let dispatchCount = 0; dispatchCount < MAX_WAKE_DISPATCHES; dispatchCount += 1) {
      const result = await dispatchNextPendingExecution({
        billingScopeId: params.billingScopeId,
        billingScopeType: params.billingScopeType,
        triggerState,
      })
      if (result.status === 'retired') rejection ??= result
      else if (result.status !== 'dispatched') {
        if (rejection) throw rejection.error
        return result
      }
    }
    if (rejection) throw rejection.error
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

  const heartbeat =
    initialTriggerState.mode === 'local' && params.executionType === 'document'
      ? await import('@/lib/knowledge/documents/local-heartbeat')
      : undefined
  const nonce = await heartbeat?.armLocalDocument(params.pendingExecutionId)
  const disarm = () => {
    if (nonce) heartbeat?.disarmLocalDocument(params.pendingExecutionId, nonce)
  }
  const admission = db.transaction(async (tx) => {
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
    if (params.executionType === 'document' && params.beforeEnqueue) {
      const [existing] = await tx
        .select({ id: pendingExecution.id })
        .from(pendingExecution)
        .where(eq(pendingExecution.id, params.pendingExecutionId))
        .limit(1)
      if (existing) return { mode: 'skipped' as const, inserted: false }
    }
    if (params.beforeEnqueue && !(await params.beforeEnqueue(tx))) {
      return { mode: 'skipped' as const, inserted: false }
    }
    const execution = {
      id: params.pendingExecutionId,
      executionType: params.executionType,
      orderingKey: params.orderingKey ?? null,
      source: params.source,
      userId: params.userId,
      workflowId: params.workflowId ?? null,
      workspaceId: params.workspaceId ?? null,
      payload: nonce ? { ...params.payload, localDocumentNonce: nonce } : params.payload,
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
          ...(nonce && { updatedAt: sql`clock_timestamp() at time zone 'UTC'` }),
        })
        .onConflictDoNothing({ target: pendingExecution.id })
        .returning({ id: pendingExecution.id })
      if (params.executionType === 'document' && params.beforeEnqueue && !inserted)
        throw new Error('Document retry admission collided')
      if (inserted) await params.afterInsert?.(tx)
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

      await tx.delete(pendingExecution).where(
        and(
          eq(pendingExecution.billingScopeId, billingScopeId),
          eq(pendingExecution.status, 'pending'),
          // A continuation owns an existing paused execution, not an expiring new request.
          ne(pendingExecution.source, 'human_in_the_loop'),
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

    if (limits.maxPendingCount !== null && !params.continuation) {
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
    await params.afterInsert?.(tx)
    return queueResult(true)
  })
  const queueResult = await admission.catch((error) => {
    disarm()
    throw error
  })

  if (!queueResult.inserted) disarm()
  if (queueResult.mode === 'skipped') {
    return { pendingExecutionId: params.pendingExecutionId, inserted: false }
  }

  if (queueResult.mode === 'local') {
    if (queueResult.inserted) {
      const job = {
        pendingExecutionId: params.pendingExecutionId,
        executionType: params.executionType,
      }
      await dispatchBackgroundExecution(job, 'local', nonce)
    }
    return {
      pendingExecutionId: params.pendingExecutionId,
      inserted: queueResult.inserted,
    }
  }

  const { billingScopeId, billingScopeType, inserted, triggerState } = queueResult

  const scope = { billingScopeId, billingScopeType, requestId: params.requestId }
  let rejected
  if (inserted) {
    const result = await dispatchNextPendingExecution({ ...scope, triggerState })
    if (result.status === 'retired') rejected = result
  } else {
    const processing = await getProcessingPendingExecution(params.pendingExecutionId)
    if (processing)
      rejected = await reconcilePendingExecutionCapacity(processing.billingScopeId, processing.id)
  }
  if (rejected) {
    await wakePendingExecution(scope).catch((error) =>
      logger.error('Wake after document admission rejection failed', { billingScopeId, error })
    )
    throw rejected.error
  }
  if (!inserted) await wakePendingExecution(scope)

  return {
    pendingExecutionId: params.pendingExecutionId,
    inserted,
  }
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
        where "parent_pending_execution"."id" = ${pendingExecution.payload}->'metadata'->>'parentPendingExecutionId'
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
  let parentPendingExecutionId = getParentPendingExecutionId(owner)

  while (parentPendingExecutionId) {
    const parent = activeRowsById.get(parentPendingExecutionId)
    if (!parent || visited.has(parent.id)) break
    owner = parent
    visited.add(parent.id)
    parentPendingExecutionId = getParentPendingExecutionId(parent)
  }

  return owner.id
}

async function releasedPendingExecutionCapacity(capacityOwnerId: string) {
  return (await getProcessingPendingExecution(capacityOwnerId)) === null
}

function workflowWorkloadLock(pendingExecutionId: string) {
  return sql`${WORKFLOW_WORKLOAD_LOCK_NAMESPACE}, hashtext(${pendingExecutionId})`
}

export function pendingExecutionCancellationUpdate() {
  const now = new Date()
  return {
    payload: sql`${pendingExecution.payload} || jsonb_build_object('cancelRequestedAt', ${now.toISOString()}::text)`,
    updatedAt: now,
  }
}

export async function withPendingWorkflowExecution<T>(
  pendingExecutionId: string,
  execute: () => Promise<T>
) {
  let execution: Promise<T> | undefined
  let closed = false
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select
        set_config('idle_in_transaction_session_timeout', '0', true),
        set_config('transaction_timeout', '0', true),
        pg_advisory_xact_lock_shared(${workflowWorkloadLock(pendingExecutionId)})`)
      if (closed) throw new Error('Workflow lock connection closed before execution')
      execution = execute()
      return execution
    })
  } finally {
    closed = true
    // Postgres.js can reject the transaction while its callback is still running.
    await execution?.catch(() => undefined)
  }
}

export async function requestCancelledWorkflowSettlement(
  pendingExecutionId: string,
  {
    billingScopeId,
    billingScopeType,
  }: Pick<PendingExecutionClaim, 'billingScopeId' | 'billingScopeType'>,
  cancelledWorkflowDurationMs: number,
  drainedWorkloadRunId?: string
) {
  if (drainedWorkloadRunId) {
    // A failed dispatch can be retried from the worker's acknowledgement after its hook exits.
    await db
      .update(pendingExecution)
      .set({
        payload: sql`jsonb_set(${pendingExecution.payload}, '{drainedWorkflowRuns}',
          coalesce(${pendingExecution.payload}->'drainedWorkflowRuns', '{}'::jsonb)
          || jsonb_build_object(${drainedWorkloadRunId}::text, ${cancelledWorkflowDurationMs}::bigint))`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(pendingExecution.id, pendingExecutionId),
          eq(pendingExecution.status, 'processing'),
          eq(pendingExecution.executionType, 'workflow'),
          eq(pendingExecution.billingScopeId, billingScopeId),
          eq(pendingExecution.billingScopeType, billingScopeType)
        )
      )
  }
  // An independent run can retry the scope wake after both original tasks and the row are gone.
  return new TriggerClient().tasks.trigger(
    PENDING_EXECUTION_TASK_ID,
    {
      pendingExecutionId,
      billingScopeId,
      billingScopeType,
      cancelledWorkflowDurationMs,
    },
    { idempotencyKey: `${getPendingExecutionTriggerKey(pendingExecutionId)}:cancel` }
  )
}

export async function finalizeCancelledPendingWorkflow(
  pendingExecutionId: string,
  durationMs: number
) {
  const stopped = await db.transaction(async (tx) => {
    const [lock] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(${workflowWorkloadLock(pendingExecutionId)}) as acquired`
    )
    if (!lock.acquired) throw new Error('Workflow execution is still draining')
    // Commit Stop before releasing the lock so a late workload cannot start during cleanup.
    const [row] = await tx
      .update(pendingExecution)
      .set(pendingExecutionCancellationUpdate())
      .where(
        and(
          eq(pendingExecution.id, pendingExecutionId),
          eq(pendingExecution.status, 'processing'),
          eq(pendingExecution.executionType, 'workflow'),
          ne(pendingExecution.billingScopeType, 'local')
        )
      )
      .returning()
    return row && asPendingExecutionClaim(row)
  })
  if (!stopped) return
  if (typeof stopped.payload.ownerCompletedAt === 'string') {
    await settlePendingExecutionOwner(stopped, { wake: false })
  } else {
    const { finalizePendingExecutionFailure } = await import(
      '@/background/pending-execution-worker'
    )
    await finalizePendingExecutionFailure(stopped, PENDING_EXECUTION_CANCELLATION_ERROR, durationMs)
  }
}

async function hasWorkflowSettlementReceipt(
  workload: { id: string; status: string },
  pendingExecutionId: string,
  signal?: AbortSignal
): Promise<boolean> {
  if (workload.status === 'COMPLETED') {
    const run = await runs.retrieve(workload.id)
    return (
      run.id === workload.id &&
      run.taskIdentifier === backgroundTaskIds.workflow &&
      run.status === 'COMPLETED' &&
      run.output?.success === true &&
      run.output.pendingExecutionId === pendingExecutionId
    )
  }
  const base = process.env.TRIGGER_API_URL || 'https://api.trigger.dev'
  const response = await fetch(
    new URL(`/api/v1/runs/${encodeURIComponent(workload.id)}/result`, base),
    {
      headers: { Authorization: `Bearer ${env.TRIGGER_SECRET_KEY}` },
      cache: 'no-store',
      redirect: 'error',
      signal,
    }
  )
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Trigger workload result returned HTTP ${response.status}`)
  const result = await response.json()
  if (result?.id !== workload.id || result.taskIdentifier !== backgroundTaskIds.workflow)
    return false
  // These raw worker errors are emitted after the task process exits. A stall can also report OOM.
  return (
    result.ok === false &&
    result.error?.type === 'INTERNAL_ERROR' &&
    (result.error.code === 'TASK_PROCESS_SIGTERM' ||
      result.error.code === 'TASK_PROCESS_MAYBE_OOM_KILLED' ||
      result.error.code === 'GRACEFUL_EXIT_TIMEOUT')
  )
}

async function reconcileProcessingPendingExecution(
  row: PendingExecutionClaim,
  capacityOwnerId: string,
  stopSignal?: AbortSignal
) {
  if (row.billingScopeType === 'local') return false
  stopSignal?.throwIfAborted()
  const page = await runs.list({
    tag: getPendingExecutionTriggerKey(row.id),
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]
  stopSignal?.throwIfAborted()
  if (stopSignal && run?.status !== 'CANCELED') return false

  if (
    typeof row.payload.ownerCompletedAt === 'string' ||
    (run?.isCompleted && run.status === 'COMPLETED')
  ) {
    if (row.executionType === 'workflow' && run?.status === 'CANCELED')
      await requestCancelledWorkflowSettlement(row.id, row, run.durationMs)
    else await settlePendingExecutionOwner(row, { wake: false })
    return releasedPendingExecutionCapacity(capacityOwnerId)
  }
  if (!run) {
    const rejection = await triggerPendingExecution(row)
    if (rejection?.status === 'finalization_failed') throw rejection.error
    if (
      rejection?.status === 'retired' &&
      (await releasedPendingExecutionCapacity(capacityOwnerId))
    )
      return rejection
    return false
  }
  if (!run.isCompleted) return false
  let cancelledWorkflowDurationMs = run.durationMs
  if (
    run.status === 'CANCELED' &&
    run.startedAt &&
    (row.executionType === 'workflow' || typeof row.payload.cancelRequestedAt === 'string')
  ) {
    const { relatedRuns } = await runs.retrieve(run.id)
    stopSignal?.throwIfAborted()
    const workloads = relatedRuns.children?.filter(
      (child) =>
        child.taskIdentifier === backgroundTaskIds[row.executionType] &&
        child.triggerFunction === 'triggerAndWait'
    )
    if (!workloads?.length || workloads.some((child) => !child.isCompleted)) return false
    for (const child of workloads) {
      if (child.startedAt) {
        if (row.executionType !== 'workflow') return false
        if (child.status === 'CANCELED') {
          // Trigger can finalize cancellation on heartbeat expiry while the workload is still executing.
          const receipts = row.payload.drainedWorkflowRuns
          const duration = isPendingExecutionPayload(receipts) ? receipts[child.id] : undefined
          if (typeof duration !== 'number') return false
          cancelledWorkflowDurationMs = duration
        } else if (!(await hasWorkflowSettlementReceipt(child, row.id, stopSignal))) return false
      } else if (child.status !== 'CANCELED') return false
    }
  }
  if (run.status === 'CANCELED' && row.executionType === 'workflow') {
    stopSignal?.throwIfAborted()
    await requestCancelledWorkflowSettlement(row.id, row, cancelledWorkflowDurationMs)
    return releasedPendingExecutionCapacity(capacityOwnerId)
  }

  const message =
    run.status === 'EXPIRED'
      ? EXPIRED_ERROR
      : run.status === 'CANCELED'
        ? PENDING_EXECUTION_CANCELLATION_ERROR
        : PENDING_EXECUTION_FAILURE_ERROR
  const { finalizePendingExecutionFailure } = await import('@/background/pending-execution-worker')
  await finalizePendingExecutionFailure(row, message, run.durationMs)
  return releasedPendingExecutionCapacity(capacityOwnerId)
}

export async function reconcileStoppedWorkflowOwner(
  pendingExecutionId: string,
  signal: AbortSignal
) {
  const owners = new Set([pendingExecutionId])
  for (const id of owners) {
    signal.throwIfAborted()
    const row = await getProcessingPendingExecution(id)
    if (
      row?.executionType !== 'workflow' ||
      row.billingScopeType === 'local' ||
      typeof row.payload.cancelRequestedAt !== 'string'
    )
      continue
    if (await reconcileProcessingPendingExecution(row, id, signal)) continue
    // A completed parent's slot can still belong to a running workflow-block child.
    for (const child of await listChildPendingWorkflowExecutions({ pendingExecutionId: id })) {
      if (getParentPendingExecutionId(child) === id) owners.add(child.id)
    }
  }
}

async function reconcilePendingExecutionCapacity(
  billingScopeId: string,
  preferredPendingExecutionId?: string
) {
  const rows = await listProcessingPendingExecutionsForBillingScope(billingScopeId)
  rows.sort(
    (left, right) =>
      Number(right.id === preferredPendingExecutionId) -
      Number(left.id === preferredPendingExecutionId)
  )

  const activeRowsById = new Map(rows.map((row) => [row.id, row]))
  for (const row of rows) {
    try {
      const capacityOwnerId = getPendingExecutionCapacityOwnerId(row, activeRowsById)
      const released = await reconcileProcessingPendingExecution(row, capacityOwnerId)
      if (typeof released === 'object') return released
      if (released) return
    } catch (error) {
      logger.error('Pending execution capacity reconciliation failed', {
        billingScopeId,
        pendingExecutionId: row.id,
        error,
      })
      throw error
    }
  }
}

export async function isPendingWorkflowExecutionCancellationRequested(
  pendingExecutionId: string,
  connection: Pick<typeof db, 'select'> = db
) {
  const [row] = await connection
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

export async function settlePendingExecutionOwner(
  row: Pick<PendingExecutionClaim, 'id'>,
  options: { wake?: boolean }
) {
  if ((await listChildPendingWorkflowExecutions({ pendingExecutionId: row.id })).length === 0) {
    await completePendingExecution({ pendingExecutionId: row.id, wake: options.wake })
    return
  }

  const ownerCompletedAt = new Date().toISOString()
  await db
    .update(pendingExecution)
    .set({
      payload: sql`${pendingExecution.payload} || jsonb_build_object('ownerCompletedAt', ${ownerCompletedAt}::text)`,
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

type WorkflowParent = { executionId: string } | { pendingExecutionId: string }

export function childPendingWorkflowScope(parent: WorkflowParent) {
  const [key, id] =
    'executionId' in parent
      ? ['parentExecutionId', parent.executionId]
      : ['parentPendingExecutionId', parent.pendingExecutionId]
  return and(
    eq(pendingExecution.executionType, 'workflow'),
    sql<boolean>`${pendingExecution.payload}->'metadata'->>${key} = ${id}`
  )
}

export async function listChildPendingWorkflowExecutions(parent: WorkflowParent) {
  const rows = await db
    .select()
    .from(pendingExecution)
    .where(childPendingWorkflowScope(parent))
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
      parentPendingExecutionId: sql<
        string | null
      >`case when ${pendingExecution.source} = ${WORKFLOW_BLOCK_SOURCE} then ${pendingExecution.payload}->'metadata'->>'parentPendingExecutionId' else null end`,
    })

  if (deleted?.billingScopeId && params.wake !== false) {
    await wakePendingExecution({
      billingScopeId: deleted.billingScopeId,
      billingScopeType: deleted.billingScopeType,
    })
  }

  if (deleted?.parentPendingExecutionId) {
    await completeOwnerWithoutChildren(deleted.parentPendingExecutionId, { wake: params.wake })
  }
}

async function completeOwnerWithoutChildren(
  pendingExecutionId: string,
  options: { wake?: boolean }
) {
  const owner = await getProcessingPendingExecution(pendingExecutionId)
  if (typeof owner?.payload.ownerCompletedAt !== 'string') return
  if ((await listChildPendingWorkflowExecutions({ pendingExecutionId })).length > 0) return
  await completePendingExecution({ pendingExecutionId, wake: options.wake })
}
