import { db } from '@tradinggoose/db'
import { LOCAL_PENDING_EXECUTION_DISPATCHER_LOCK_ID } from '@/lib/execution/execution-mode-lock'
import {
  claimNextLocalPendingExecutionBatch,
  completePendingExecution,
  isPendingExecutionOwnerCompleted,
  listChildPendingWorkflowExecutions,
  listProcessingPendingExecutions,
  renewProcessingPendingExecutions,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { getTriggerExecutionState } from '@/lib/trigger/settings'
import {
  executePendingExecution,
  finalizePendingExecutionFailure,
} from '@/background/pending-execution-worker'

const POLL_INTERVAL_MS = 2_000
const ACTIVE_EXECUTION_LEASE_MS = 10_000
const PAGE_SIZE = 50
const LOCAL_INTERRUPTION_ERROR = 'Local workflow execution stopped before it could finish'
const logger = createLogger('LocalPendingExecutionRuntime')

const active = new Set<string>()
const activePromises = new Set<Promise<void>>()
let leadership: {
  acquiredAt: number
  connection: Awaited<ReturnType<typeof db.$client.reserve>>
  backendPid: number
} | null = null
let currentTick: Promise<void> | undefined
let processingCursor: string | undefined
let stopping = false
let scopeCursor: string | undefined
let timer: ReturnType<typeof setInterval> | undefined

async function ensureLeadership() {
  if (leadership) {
    try {
      const [session] = await leadership.connection<{ backendPid: number }[]>`
        select pg_backend_pid()::int as "backendPid"
      `
      if (session?.backendPid === leadership.backendPid) return true
    } catch (error) {
      logger.error('Local dispatcher database session was lost', { error })
    }
    await releaseLeadership().catch((error) => {
      logger.error('Local dispatcher database session release failed', { error })
    })
  }

  if (active.size > 0) return false

  const connection = await db.$client.reserve()
  try {
    const [result] = await connection<{ acquired: boolean; backendPid: number }[]>`
      select
        pg_try_advisory_lock(${LOCAL_PENDING_EXECUTION_DISPATCHER_LOCK_ID}) as acquired,
        pg_backend_pid()::int as "backendPid"
    `
    if (!result?.acquired) {
      connection.release()
      return false
    }
    leadership = { acquiredAt: Date.now(), connection, backendPid: result.backendPid }
    return true
  } catch (error) {
    connection.release()
    throw error
  }
}

async function releaseLeadership() {
  if (!leadership) return
  const { connection } = leadership
  leadership = null
  try {
    await connection`select pg_advisory_unlock(${LOCAL_PENDING_EXECUTION_DISPATCHER_LOCK_ID})`
  } finally {
    connection.release()
  }
}

async function reconcileInterruptedLocalExecutions() {
  const staleBefore = Date.now() - ACTIVE_EXECUTION_LEASE_MS
  const rows = await listProcessingPendingExecutions({
    afterId: processingCursor,
    limit: PAGE_SIZE,
    mode: 'local',
  })
  if (!rows) return false

  for (const row of rows) {
    if (active.has(row.id) || row.updatedAt.getTime() > staleBefore) continue

    if (isPendingExecutionOwnerCompleted(row)) {
      if ((await listChildPendingWorkflowExecutions(row.id)).length === 0) {
        await completePendingExecution({ pendingExecutionId: row.id })
      }
    } else {
      await finalizePendingExecutionFailure(
        row,
        LOCAL_INTERRUPTION_ERROR,
        row.processingStartedAt ? Date.now() - row.processingStartedAt.getTime() : 1
      )
    }
  }
  processingCursor = rows.length === PAGE_SIZE ? rows.at(-1)?.id : undefined
  return true
}

function startExecution(pendingExecutionId: string) {
  active.add(pendingExecutionId)
  const execution = executePendingExecution({ pendingExecutionId })
    .then(() => undefined)
    .catch((error) => {
      logger.error('Local pending execution finalization failed', {
        pendingExecutionId,
        error,
      })
    })
    .finally(() => {
      active.delete(pendingExecutionId)
      activePromises.delete(execution)
    })
  activePromises.add(execution)
}

async function dispatchLocalExecutions() {
  const batch = await claimNextLocalPendingExecutionBatch({
    afterBillingScopeId: scopeCursor,
    limit: PAGE_SIZE,
  })
  if (!batch) return false

  scopeCursor = batch.nextBillingScopeId
  for (const row of batch.rows) {
    startExecution(row.id)
  }
  return true
}

async function tick() {
  try {
    await renewProcessingPendingExecutions([...active])
    const { mode } = await getTriggerExecutionState()
    if (mode !== 'local') {
      await releaseLeadership()
      return
    }
    if (!(await ensureLeadership()) || !leadership) return

    if (
      Date.now() - leadership.acquiredAt >= ACTIVE_EXECUTION_LEASE_MS &&
      !(await reconcileInterruptedLocalExecutions())
    ) {
      await releaseLeadership()
      return
    }
    if (!(await dispatchLocalExecutions())) await releaseLeadership()
  } catch (error) {
    logger.error('Local pending execution dispatch failed', { error })
  }
}

function scheduleTick() {
  if (currentTick || stopping) return
  currentTick = tick().finally(() => {
    currentTick = undefined
  })
}

export function startLocalPendingExecutionRuntime() {
  if (timer) return
  stopping = false
  scheduleTick()
  timer = setInterval(scheduleTick, POLL_INTERVAL_MS)
  timer.unref?.()
}

export async function stopLocalPendingExecutionRuntime() {
  stopping = true
  if (timer) clearInterval(timer)
  timer = undefined

  await currentTick
  await Promise.allSettled(activePromises)
  await releaseLeadership()
}
