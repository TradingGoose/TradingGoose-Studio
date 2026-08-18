import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { runs, task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  completePendingExecution,
  getPendingExecutionTriggerKey,
  getProcessingPendingExecution,
  isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions,
  markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID,
  type PendingExecutionClaim,
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
    await completePendingExecution({ pendingExecutionId: row.id })
  } else {
    await markPendingExecutionOwnerCompleted(row)
  }
}

async function executePendingExecution(payload: PendingExecutionTaskPayload) {
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
    const message = error instanceof Error ? error.message : PENDING_EXECUTION_WORKER_FAILURE_ERROR
    await finalizePendingExecutionFailure(row, message, 1)
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
  message: string
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
  const page = await runs.list({
    tag: getPendingExecutionTriggerKey(row.id),
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]
  if (run && !run.isCompleted && !run.isCancelled) {
    await runs.cancel(run.id)
  }
}

async function cancelPendingExecutionDescendants(
  parentExecutionId: string,
  options: { wake?: boolean } = {}
) {
  const children = await listChildPendingWorkflowExecutions(parentExecutionId)

  await mapWithConcurrency(children, DESCENDANT_CANCELLATION_CONCURRENCY, async (child) => {
    await cancelPendingExecutionDescendants(child.id, options)
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
