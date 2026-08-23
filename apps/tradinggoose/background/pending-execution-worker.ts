import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { retry, runs, task, timeout } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  completePendingExecution,
  getPendingExecutionTriggerKey,
  getProcessingPendingExecution,
  isTerminalPendingExecutionRunStatus,
  isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions,
  markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID,
  PENDING_EXECUTION_TIME_LIMIT_ERROR,
  type PendingExecutionClaim,
  wakePendingExecution,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import { markDocumentProcessingJobFailed } from './knowledge-processing'
import { executePendingExecutionJob } from './pending-execution-job'

const logger = createLogger('PendingExecutionWorker')
export const PENDING_EXECUTION_WORKER_FAILURE_ERROR =
  'Workflow execution stopped before it could finish'
const DESCENDANT_CANCELLATION_CONCURRENCY = 5
const PENDING_EXECUTION_RUN_TASK_ID = 'pending-execution-run'

type PendingExecutionTaskPayload = {
  pendingExecutionId: string
  executionMaxDuration?: number
}

type PendingExecutionRunTaskPayload = {
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

async function getWorkflowExecutionLog(executionId: string) {
  const [log] = await db
    .select({
      id: workflowExecutionLogs.id,
      endedAt: workflowExecutionLogs.endedAt,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return log
}

async function dispatchPendingExecution(row: PendingExecutionClaim) {
  await executePendingExecutionJob(row, { triggerRuntime: true })
  if ((await listChildPendingWorkflowExecutions(row.id)).length === 0) {
    await completePendingExecution({ pendingExecutionId: row.id, wake: false })
  } else {
    await markPendingExecutionOwnerCompleted(row, { wake: false })
  }
}

async function executePendingExecutionRun(payload: PendingExecutionRunTaskPayload) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }

  await dispatchPendingExecution(row)
  return { success: true, pendingExecutionId: row.id }
}

export const pendingExecutionRunTask = task<
  typeof PENDING_EXECUTION_RUN_TASK_ID,
  PendingExecutionRunTaskPayload
>({
  id: PENDING_EXECUTION_RUN_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: executePendingExecutionRun,
})

function isMaxDurationError(error: unknown) {
  return error instanceof Error && error.name === 'MAX_DURATION_EXCEEDED'
}

function getPendingExecutionFailureMessage(error: unknown) {
  if (isMaxDurationError(error)) return PENDING_EXECUTION_TIME_LIMIT_ERROR
  if (isRecord(error) && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }
  return PENDING_EXECUTION_WORKER_FAILURE_ERROR
}

async function finalizePendingExecutionRunFailure(
  payload: PendingExecutionTaskPayload,
  error: unknown,
  startedAt: number
) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) return

  const message = getPendingExecutionFailureMessage(error)
  const durationMs =
    isMaxDurationError(error) &&
    payload.executionMaxDuration !== undefined &&
    payload.executionMaxDuration !== timeout.None
      ? payload.executionMaxDuration * 1_000
      : Math.max(1, Date.now() - startedAt)
  logger.error('Pending execution failed', {
    pendingExecutionId: row.id,
    executionType: row.executionType,
    workflowId: row.workflowId,
    error,
  })
  await finalizePendingExecutionFailure(row, message, durationMs, { wake: false })
  return message
}

async function executePendingExecution(payload: PendingExecutionTaskPayload) {
  const startedAt = Date.now()
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }
  const result = await pendingExecutionRunTask.triggerAndWait(
    { pendingExecutionId: payload.pendingExecutionId },
    payload.executionMaxDuration === undefined
      ? undefined
      : { maxDuration: payload.executionMaxDuration }
  )

  const failureMessage = result.ok
    ? undefined
    : await finalizePendingExecutionRunFailure(payload, result.error, startedAt)
  await retry.onThrow(
    () =>
      wakePendingExecution({
        billingScopeId: row.billingScopeId,
        billingScopeType: row.billingScopeType,
      }),
    { maxAttempts: 3 }
  )
  if (failureMessage) throw new Error(failureMessage)
  return result.ok ? result.output : { success: true, skipped: 'not_processing' as const }
}

export const pendingExecutionTask = task<
  typeof PENDING_EXECUTION_TASK_ID,
  PendingExecutionTaskPayload
>({
  id: PENDING_EXECUTION_TASK_ID,
  maxDuration: timeout.None,
  retry: {
    maxAttempts: 1,
  },
  run: executePendingExecution,
})

async function terminalizeWorkflowExecution(
  row: PendingExecutionClaim,
  durationMs: number,
  message: string
) {
  if (!isTierLimitedPendingExecution(row)) return
  if (!row.workflowId || !row.workspaceId) {
    logger.error('Pending execution is missing workflow scope during failure finalization', {
      pendingExecutionId: row.id,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
    })
    return
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
    billable: true,
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
  if (row.billingScopeType === 'local') return

  try {
    const page = await runs.list({
      tag: getPendingExecutionTriggerKey(row.id),
      taskIdentifier: PENDING_EXECUTION_TASK_ID,
      limit: 1,
    })
    const run = page.data[0]
    if (run && !isTerminalPendingExecutionRunStatus(run.status)) {
      await runs.cancel(run.id)
    }
  } catch (error) {
    logger.error('Failed to cancel Trigger run for pending execution', {
      pendingExecutionId: row.id,
      error,
    })
  }
}

async function cancelPendingExecutionDescendants(
  parentExecutionId: string,
  options: { wake?: boolean } = {},
  visited = new Set<string>()
) {
  if (visited.has(parentExecutionId)) return false
  visited.add(parentExecutionId)
  const children = await listChildPendingWorkflowExecutions(parentExecutionId)

  await mapWithConcurrency(children, DESCENDANT_CANCELLATION_CONCURRENCY, async (child) => {
    if (visited.has(child.id)) return
    await cancelPendingExecutionDescendants(child.id, options, visited)
    await cancelPendingWorkflowExecution({
      pendingExecutionId: child.id,
      userId: child.userId,
      wake: options.wake,
    })
    await cancelTriggerRun(child)
  })

  return (await listChildPendingWorkflowExecutions(parentExecutionId)).length > 0
}

export async function finalizePendingExecutionFailure(
  row: PendingExecutionClaim,
  message: string,
  durationMs: number,
  options: { wake?: boolean } = {}
) {
  if (row.executionType === 'document') {
    await markDocumentProcessingJobFailed(row.payload, message)
  }

  await terminalizeWorkflowExecution(row, durationMs, message)

  const hasDescendants = await cancelPendingExecutionDescendants(row.id, options)
  if (hasDescendants) {
    await markPendingExecutionOwnerCompleted(row, options)
    return false
  }

  await completePendingExecution({
    pendingExecutionId: row.id,
    wake: options.wake,
  })
  return true
}
