import { randomUUID } from 'node:crypto'
import {
  claimNextPendingExecution,
  completePendingExecution,
  isPendingExecutionOwnerCompleted,
  listChildPendingWorkflowExecutions,
  listPendingExecutionBillingScopes,
  listProcessingPendingExecutions,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { acquireLock, releaseLock, renewLock } from '@/lib/redis'
import { getTriggerExecutionState } from '@/lib/trigger/settings'
import {
  executePendingExecution,
  finalizePendingExecutionFailure,
} from '@/background/pending-execution-worker'

const POLL_INTERVAL_MS = 2_000
const LEASE_RENEW_INTERVAL_MS = 30_000
const LEASE_TTL_SECONDS = 90
const MAX_LOCAL_EXECUTIONS = 20
const PAGE_SIZE = 50
const LEASE_KEY = 'pending-execution:local-dispatcher'
const LOCAL_INTERRUPTION_ERROR = 'Local workflow execution stopped before it could finish'
const logger = createLogger('LocalPendingExecutionRuntime')

const active = new Set<string>()
const leaseValue = randomUUID()
let lastLeaseRenewalAt = 0
let leader = false
let processingCursor: string | undefined
let runningTick = false
let scopeCursor: string | undefined
let timer: ReturnType<typeof setInterval> | undefined

async function ensureLeadership() {
  if (!leader) {
    leader = await acquireLock(LEASE_KEY, leaseValue, LEASE_TTL_SECONDS)
  } else if (Date.now() - lastLeaseRenewalAt >= LEASE_RENEW_INTERVAL_MS) {
    leader = await renewLock(LEASE_KEY, leaseValue, LEASE_TTL_SECONDS)
  }
  if (leader) lastLeaseRenewalAt = Date.now()
  return leader
}

async function reconcileInterruptedLocalExecutions() {
  const rows = await listProcessingPendingExecutions({
    afterId: processingCursor,
    limit: PAGE_SIZE,
  })
  for (const row of rows) {
    if (active.has(row.id)) continue

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
}

function startExecution(pendingExecutionId: string) {
  active.add(pendingExecutionId)
  void executePendingExecution({ pendingExecutionId })
    .then(() => undefined)
    .catch((error) => {
      logger.error('Local pending execution finalization failed', {
        pendingExecutionId,
        error,
      })
    })
    .finally(() => {
      active.delete(pendingExecutionId)
    })
}

async function dispatchLocalExecutions() {
  const available = MAX_LOCAL_EXECUTIONS - active.size
  if (available <= 0) return

  const scopes = await listPendingExecutionBillingScopes({
    afterBillingScopeId: scopeCursor,
    limit: Math.min(PAGE_SIZE, available),
  })
  if (scopes.length === 0) {
    scopeCursor = undefined
    return
  }

  for (const { billingScopeId } of scopes) {
    while (active.size < MAX_LOCAL_EXECUTIONS) {
      const claim = await claimNextPendingExecution(billingScopeId)
      if (claim.status !== 'claimed') break
      startExecution(claim.row.id)
    }
  }

  scopeCursor = scopes.at(-1)?.billingScopeId
}

async function tick() {
  if (runningTick) return
  runningTick = true

  try {
    const { mode } = await getTriggerExecutionState()
    if (mode !== 'local') {
      if (leader && active.size === 0) {
        await releaseLock(LEASE_KEY, leaseValue)
        leader = false
      }
      return
    }
    if (!(await ensureLeadership())) return

    await reconcileInterruptedLocalExecutions()
    await dispatchLocalExecutions()
  } catch (error) {
    logger.error('Local pending execution dispatch failed', { error })
  } finally {
    runningTick = false
  }
}

export function startLocalPendingExecutionRuntime() {
  if (timer) return
  void tick()
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS)
  timer.unref?.()
}

export async function stopLocalPendingExecutionRuntime() {
  if (timer) clearInterval(timer)
  timer = undefined

  if (leader && active.size === 0) {
    await releaseLock(LEASE_KEY, leaseValue)
    leader = false
  }
}
