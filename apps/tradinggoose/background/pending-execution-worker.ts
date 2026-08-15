import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { runs, schedules, task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  completePendingExecution,
  getPendingExecutionTriggerKey,
  getProcessingPendingExecution,
  isPendingWorkflowExecutionCancellationRequested,
  isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions,
  listPendingExecutionBillingScopes,
  listProcessingPendingExecutions,
  markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID,
  type PendingExecutionClaim,
  triggerPendingExecution,
  wakePendingExecution,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import { getAirtablePollContinuation } from '@/lib/webhooks/utils'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import { markDocumentProcessingJobFailed } from './knowledge-processing'
import { executePendingExecutionJob } from './pending-execution-job'

const logger = createLogger('PendingExecutionWorker')
const TIME_LIMIT_ERROR = 'Workflow execution time limit exceeded'
const CANCELLATION_ERROR = 'Workflow execution was cancelled'
const EXPIRED_ERROR = 'Workflow execution expired before it started'
const WORKER_FAILURE_ERROR = 'Workflow execution stopped before it could finish'
const RECOVERY_PAGE_SIZE = 50
const RECOVERY_CONCURRENCY = 5
const ACTIVE_RUN_STATUSES = new Set([
  'PENDING_VERSION',
  'QUEUED',
  'DEQUEUED',
  'EXECUTING',
  'WAITING',
  'DELAYED',
])

type PendingExecutionTaskPayload = {
  pendingExecutionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getExecutionTriggerType(row: PendingExecutionClaim): ExecutionTrigger['type'] {
  if (row.executionType === 'webhook' || row.executionType === 'monitor') return 'webhook'
  if (row.executionType === 'schedule') return 'schedule'

  const triggerType = row.payload.triggerType
  if (triggerType === 'api-endpoint') return 'api'
  if (
    triggerType === 'api' ||
    triggerType === 'webhook' ||
    triggerType === 'schedule' ||
    triggerType === 'chat'
  ) {
    return triggerType
  }
  return 'manual'
}

function getWorkflowState(row: PendingExecutionClaim): WorkflowState {
  if (row.payload.executionTarget === 'live' && isRecord(row.payload.workflowData)) {
    return row.payload.workflowData as unknown as WorkflowState
  }

  return {
    blocks: {},
    edges: [],
    loops: {},
    parallels: {},
  }
}

function isAirtablePendingExecution(row: PendingExecutionClaim) {
  return row.executionType === 'webhook' && row.source === 'webhook:airtable'
}

async function getWorkflowExecutionLog(executionId: string) {
  const [log] = await db
    .select({
      id: workflowExecutionLogs.id,
      endedAt: workflowExecutionLogs.endedAt,
      level: workflowExecutionLogs.level,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return log
}

async function hasCompletedAirtableContinuation(row: PendingExecutionClaim) {
  if (!isAirtablePendingExecution(row)) return false

  try {
    if (!getAirtablePollContinuation(row.payload)) return false
  } catch {
    return false
  }

  const executionLog = await getWorkflowExecutionLog(row.id)
  return executionLog?.level === 'info' && Boolean(executionLog.endedAt)
}

async function dispatchPendingExecution(row: PendingExecutionClaim) {
  await executePendingExecutionJob(row, { triggerRuntime: true })
  if ((await listChildPendingWorkflowExecutions(row.id)).length === 0) {
    await completePendingExecution({ pendingExecutionId: row.id })
  } else {
    await markPendingExecutionOwnerCompleted(row)
  }
}

export async function executePendingExecution(payload: PendingExecutionTaskPayload) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }

  try {
    await dispatchPendingExecution(row)
    return { success: true, pendingExecutionId: row.id }
  } catch (error) {
    logger.error('Pending execution failed', {
      pendingExecutionId: row.id,
      executionType: row.executionType,
      workflowId: row.workflowId,
      error,
    })
    const currentRow = isAirtablePendingExecution(row)
      ? await getProcessingPendingExecution(row.id)
      : null
    if (currentRow && (await hasCompletedAirtableContinuation(currentRow))) {
      throw error
    }
    const message = error instanceof Error ? error.message : WORKER_FAILURE_ERROR
    await finalizePendingExecutionFailure(row, message, 1, {
      cancelTriggerRuns: true,
    })
    throw error
  }
}

export const pendingExecutionTask = task<
  typeof PENDING_EXECUTION_TASK_ID,
  PendingExecutionTaskPayload
>({
  id: PENDING_EXECUTION_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: executePendingExecution,
})

async function terminalizeWorkflowExecution(
  row: PendingExecutionClaim,
  durationMs: number,
  message: string,
  billable = true
) {
  if (!isTierLimitedPendingExecution(row)) return
  if (!row.workflowId || !row.workspaceId) {
    throw new Error(`Execution ${row.id} is missing workflow scope`)
  }

  const existingLog = await getWorkflowExecutionLog(row.id)
  if (existingLog?.endedAt) {
    return
  }

  const loggingSession = new LoggingSession(
    row.workflowId,
    row.id,
    getExecutionTriggerType(row),
    row.id.slice(0, 8),
    existingLog?.id
  )

  if (!existingLog) {
    const triggerData = isRecord(row.payload.triggerData) ? row.payload.triggerData : undefined
    const metadata = isRecord(row.payload.metadata) ? row.payload.metadata : undefined
    await loggingSession.start({
      userId: row.userId,
      workspaceId: row.workspaceId,
      workflowState: getWorkflowState(row),
      triggerData: metadata ? { ...(triggerData ?? {}), queuedExecution: metadata } : triggerData,
    })
  }

  await loggingSession.completeWithError({
    totalDurationMs: Math.max(1, Math.round(durationMs)),
    error: { message },
    workspaceId: row.workspaceId,
    actorUserId: row.userId,
    billable,
  })
}

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  callback: (item: T) => Promise<void>
) {
  for (let index = 0; index < items.length; index += concurrency) {
    await Promise.all(items.slice(index, index + concurrency).map(callback))
  }
}

async function cancelTriggerRun(row: PendingExecutionClaim) {
  const page = await runs.list({
    tag: getPendingExecutionTriggerKey(row.id),
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]
  if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
    await runs.cancel(run.id)
  }
}

async function cancelPendingExecutionDescendants(
  parentExecutionId: string,
  cancelTriggerRuns: boolean
) {
  const children = await listChildPendingWorkflowExecutions(parentExecutionId)

  await mapWithConcurrency(children, RECOVERY_CONCURRENCY, async (child) => {
    await cancelPendingExecutionDescendants(child.id, cancelTriggerRuns)
    await cancelPendingWorkflowExecution({
      pendingExecutionId: child.id,
      userId: child.userId,
    })
    if (cancelTriggerRuns) {
      await cancelTriggerRun(child)
    }
  })

  return (await listChildPendingWorkflowExecutions(parentExecutionId)).length > 0
}

export async function finalizePendingExecutionFailure(
  row: PendingExecutionClaim,
  message: string,
  durationMs: number,
  options: { cancelTriggerRuns?: boolean; billable?: boolean } = {}
) {
  if (row.executionType === 'document') {
    await markDocumentProcessingJobFailed(row.payload, message)
  }

  await terminalizeWorkflowExecution(row, durationMs, message, options.billable !== false)

  const hasDescendants = await cancelPendingExecutionDescendants(
    row.id,
    options.cancelTriggerRuns === true
  )
  if (hasDescendants) {
    await markPendingExecutionOwnerCompleted(row)
    return false
  }

  await completePendingExecution({ pendingExecutionId: row.id })
  return true
}

function getProcessingDurationMs(row: PendingExecutionClaim) {
  return row.processingStartedAt ? Date.now() - row.processingStartedAt.getTime() : 1
}

async function reconcileProcessingExecution(row: PendingExecutionClaim) {
  const cancellationRequested = await isPendingWorkflowExecutionCancellationRequested(row.id)
  const triggerKey = getPendingExecutionTriggerKey(row.id)
  const page = await runs.list({
    tag: triggerKey,
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]

  if (!run) {
    if (cancellationRequested) {
      await finalizePendingExecutionFailure(row, CANCELLATION_ERROR, getProcessingDurationMs(row), {
        cancelTriggerRuns: true,
        billable: false,
      })
      return
    }
    await triggerPendingExecution(row)
    return
  }

  if (ACTIVE_RUN_STATUSES.has(run.status)) {
    if (cancellationRequested) {
      await runs.cancel(run.id)
    }
    return
  }

  if (
    run.status !== 'COMPLETED' &&
    !cancellationRequested &&
    (await hasCompletedAirtableContinuation(row))
  ) {
    await dispatchPendingExecution(row)
    return
  }

  if (run.status === 'TIMED_OUT') {
    await finalizePendingExecutionFailure(row, TIME_LIMIT_ERROR, run.durationMs, {
      cancelTriggerRuns: true,
    })
    return
  }

  if (run.status !== 'COMPLETED') {
    const cancelled = run.status === 'CANCELED'
    const message = cancelled
      ? CANCELLATION_ERROR
      : run.status === 'EXPIRED'
        ? EXPIRED_ERROR
        : WORKER_FAILURE_ERROR
    await finalizePendingExecutionFailure(row, message, run.durationMs, {
      cancelTriggerRuns: true,
      billable: !cancelled,
    })
    return
  }

  if ((await listChildPendingWorkflowExecutions(row.id)).length > 0) {
    return
  }

  await completePendingExecution({ pendingExecutionId: row.id })
}

export async function recoverPendingExecutions() {
  let reconciledCount = 0
  let processingCursor: string | undefined
  while (true) {
    const batch = await listProcessingPendingExecutions({
      afterId: processingCursor,
      limit: RECOVERY_PAGE_SIZE,
    })
    if (!batch) {
      return { pendingScopeCount: 0, reconciledCount }
    }

    const rows = batch
    await mapWithConcurrency(rows, RECOVERY_CONCURRENCY, async (row) => {
      try {
        await reconcileProcessingExecution(row)
        reconciledCount += 1
      } catch (error) {
        logger.error('Pending execution reconciliation failed', {
          pendingExecutionId: row.id,
          error,
        })
      }
    })
    if (rows.length < RECOVERY_PAGE_SIZE) break
    processingCursor = rows.at(-1)?.id
  }

  let pendingScopeCount = 0
  let scopeCursor: string | undefined
  while (true) {
    const batch = await listPendingExecutionBillingScopes({
      afterBillingScopeId: scopeCursor,
      limit: RECOVERY_PAGE_SIZE,
    })
    if (!batch) {
      return { pendingScopeCount, reconciledCount }
    }
    const scopes = batch
    await mapWithConcurrency(scopes, RECOVERY_CONCURRENCY, ({ billingScopeId }) =>
      wakePendingExecution({ billingScopeId }).then(() => undefined)
    )
    pendingScopeCount += scopes.length
    if (scopes.length < RECOVERY_PAGE_SIZE) break
    scopeCursor = scopes.at(-1)?.billingScopeId
  }

  return {
    pendingScopeCount,
    reconciledCount,
  }
}

export const pendingExecutionRecoverySweep = schedules.task({
  id: 'pending-execution-recovery-sweep',
  cron: '* * * * *',
  queue: {
    name: 'pending-execution-recovery',
    concurrencyLimit: 1,
  },
  run: recoverPendingExecutions,
})
