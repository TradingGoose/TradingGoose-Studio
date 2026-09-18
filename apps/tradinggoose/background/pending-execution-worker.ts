import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { AbortTaskRunError, task, timeout, wait } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  cancelPendingExecutionTriggerRun,
  getProcessingPendingExecution,
  isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions,
  PENDING_EXECUTION_CANCELLATION_ERROR,
  PENDING_EXECUTION_FAILURE_ERROR,
  PENDING_EXECUTION_TASK_ID,
  PENDING_EXECUTION_TIME_LIMIT_ERROR,
  type PendingExecutionClaim,
  settlePendingExecutionOwner,
  wakePendingExecution,
} from '@/lib/execution/pending-execution'
import { readWorkflowExecutionEventState } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import { executionLogger } from '@/lib/logs/execution/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import {
  completeWorkflowCheckpointChild,
  readWorkflowCheckpointChildren,
  readWorkflowCheckpointSnapshot,
  recoverWorkflowCheckpointSegment,
} from '@/lib/workflows/human-in-the-loop/service'
import { cancelPendingWorkflowExecution } from '@/lib/workflows/queued-execution-cancellation'
import { markDocumentProcessingJobFailed } from './knowledge-processing'
import { executePendingExecutionJob } from './pending-execution-job'
import { isScheduleExecutionPayload, settleScheduleOccurrence } from './schedule-execution'

const logger = createLogger('PendingExecutionWorker')
const DESCENDANT_CANCELLATION_CONCURRENCY = 5
const PENDING_EXECUTION_RUN_TASK_ID = 'pending-execution-run'
const PENDING_EXECUTION_WAKE_RETRY_SECONDS = 30

type PendingExecutionTaskPayload = {
  pendingExecutionId: string
  billingScopeId: string
  billingScopeType: string
  executionMaxDuration?: number
}

type PendingExecutionRunTaskPayload = {
  pendingExecutionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getExecutionTriggerType(
  row: Pick<PendingExecutionClaim, 'executionType' | 'payload'>
): ExecutionTrigger['type'] {
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

function getWorkflowState(row: Pick<PendingExecutionClaim, 'payload'>): WorkflowState {
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

async function executePendingExecutionRun(payload: PendingExecutionRunTaskPayload) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }

  if (!(await recoverPendingExecutionCheckpoint(row))) {
    await executePendingExecutionJob(row, { triggerRuntime: true })
    await settlePendingExecutionOwner(row, { wake: false })
  }
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
  return PENDING_EXECUTION_FAILURE_ERROR
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
  if (await finalizePendingExecutionFailure(row, message, durationMs)) return undefined
  return message
}

const PENDING_EXECUTION_WAKE_MAX_ATTEMPTS = 10

async function wakePendingExecutionUntilSuccessful(payload: PendingExecutionTaskPayload) {
  for (let attempt = 1; attempt <= PENDING_EXECUTION_WAKE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await wakePendingExecution(payload)
      return
    } catch (error) {
      if (attempt === PENDING_EXECUTION_WAKE_MAX_ATTEMPTS) {
        logger.error('Pending execution wake exhausted retries', {
          pendingExecutionId: payload.pendingExecutionId,
          error,
        })
        throw error
      }
      await wait.for({ seconds: PENDING_EXECUTION_WAKE_RETRY_SECONDS })
    }
  }
}

async function executePendingExecution(payload: PendingExecutionTaskPayload) {
  const startedAt = Date.now()
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    await wakePendingExecutionUntilSuccessful(payload)
    return { success: true, skipped: 'not_processing' as const }
  }
  if (typeof row.payload.ownerCompletedAt === 'string') {
    await wakePendingExecutionUntilSuccessful(payload)
    return { success: true, pendingExecutionId: row.id, skipped: 'owner_completed' as const }
  }
  const result = await pendingExecutionRunTask.triggerAndWait(
    { pendingExecutionId: payload.pendingExecutionId },
    {
      idempotencyKey: `${PENDING_EXECUTION_RUN_TASK_ID}:${payload.pendingExecutionId}`,
      ...(payload.executionMaxDuration === undefined
        ? {}
        : { maxDuration: payload.executionMaxDuration }),
    }
  )

  const failureMessage = result.ok
    ? undefined
    : await finalizePendingExecutionRunFailure(payload, result.error, startedAt)
  await wakePendingExecutionUntilSuccessful(payload)
  if (failureMessage) throw new AbortTaskRunError(failureMessage)
  return result.ok ? result.output : { success: true, skipped: 'not_processing' as const }
}

export const pendingExecutionTask = task<
  typeof PENDING_EXECUTION_TASK_ID,
  PendingExecutionTaskPayload
>({
  id: PENDING_EXECUTION_TASK_ID,
  maxDuration: timeout.None,
  retry: {
    maxAttempts: 10,
  },
  run: executePendingExecution,
})

export async function terminalizeWorkflowExecution(
  row: Pick<
    PendingExecutionClaim,
    'id' | 'executionType' | 'source' | 'workflowId' | 'workspaceId' | 'userId' | 'payload'
  >,
  durationMs: number,
  message: string,
  billable = true
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

  const executionId =
    typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id
  const [existingLog] = await db
    .select({
      id: workflowExecutionLogs.id,
      endedAt: workflowExecutionLogs.endedAt,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)
  if (existingLog?.endedAt) {
    await executionLogger.settleWorkflowExecutionUsage(executionId)
    const terminal = await readWorkflowExecutionEventState({
      pendingExecutionId: executionId,
      workflowId: row.workflowId,
    })
    if (terminal?.status === 'completed' || terminal?.status === 'failed') {
      await completeWorkflowCheckpointChild({
        childExecutionId: executionId,
        input: { ...terminal.result },
      })
    }
    return
  }
  const snapshot =
    row.source === 'human_in_the_loop' || row.payload.resumeExecutionId
      ? await readWorkflowCheckpointSnapshot(executionId)
      : null
  const progress = snapshot
    ? buildTraceSpans({
        success: false,
        output: {},
        logs: snapshot.executor.context.blockLogs,
        metadata: snapshot.executor.context.metadata,
      })
    : null

  const loggingSession = new LoggingSession(
    row.workflowId,
    executionId,
    snapshot
      ? snapshot.triggerType === 'api-endpoint'
        ? 'api'
        : snapshot.triggerType
      : getExecutionTriggerType(row),
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

  await loggingSession.complete({
    totalDurationMs: Math.max(
      0,
      Math.round(durationMs + (snapshot?.executor.context.metadata.duration ?? 0))
    ),
    success: false,
    failureReason: message,
    workspaceId: row.workspaceId,
    billable,
    ...(progress ? { traceSpans: progress.traceSpans } : {}),
  })
  await completeWorkflowCheckpointChild({
    childExecutionId: executionId,
    input: {
      success: false,
      output: {},
      error: message,
      ...(progress ? { traceSpans: progress.traceSpans } : {}),
    },
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

export async function cancelPendingExecutionDescendants(
  parentExecutionId: string,
  visited = new Set<string>()
) {
  if (visited.has(parentExecutionId)) return
  visited.add(parentExecutionId)
  const queuedChildren = await listChildPendingWorkflowExecutions({
    executionId: parentExecutionId,
  })
  const checkpointChildren = await readWorkflowCheckpointChildren(parentExecutionId)
  const children = [
    ...new Map(
      [...queuedChildren, ...checkpointChildren].map((child) => [child.id, child])
    ).values(),
  ]
  await mapWithConcurrency(children, DESCENDANT_CANCELLATION_CONCURRENCY, async (child) => {
    if (visited.has(child.id)) return
    const result = await cancelPendingWorkflowExecution({
      pendingExecutionId: child.id,
      userId: child.userId,
      wake: false,
      descendantCancellation: true,
    })
    await cancelPendingExecutionDescendants(child.id, visited)
    if (result.status === 'not_found' || !result.pendingExecutionId) return
    const processingChild = await getProcessingPendingExecution(result.pendingExecutionId)
    if (!processingChild) return
    let cancellation: Awaited<ReturnType<typeof cancelPendingExecutionTriggerRun>>
    try {
      cancellation = await cancelPendingExecutionTriggerRun(processingChild)
    } catch (error) {
      logger.error('Failed to cancel Trigger run for pending execution', {
        pendingExecutionId: processingChild.id,
        error,
      })
      return
    }

    if (cancellation.type === 'local' || cancellation.type === 'missing') return

    if (cancellation.run.status !== 'CANCELED') {
      if (cancellation.run.status === 'COMPLETED') {
        await settlePendingExecutionOwner(processingChild, { wake: false })
      }
      return
    }

    await terminalizeWorkflowExecution(
      processingChild,
      cancellation.run.durationMs,
      PENDING_EXECUTION_CANCELLATION_ERROR
    )
    await settlePendingExecutionOwner(processingChild, { wake: false })
  })
}

async function recoverPendingExecutionCheckpoint(row: PendingExecutionClaim) {
  if (
    row.executionType !== 'document' &&
    (await recoverWorkflowCheckpointSegment({
      executionId:
        typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id,
      userId: row.userId,
      workflowId: row.workflowId,
      checkpointRevision:
        typeof row.payload.checkpointRevision === 'number' ? row.payload.checkpointRevision : 0,
    }))
  ) {
    if (row.executionType === 'schedule') {
      if (!isScheduleExecutionPayload(row.payload)) throw new Error('Invalid schedule payload')
      await settleScheduleOccurrence(row.payload, 'success')
    }
    await settlePendingExecutionOwner(row, { wake: false })
    return true
  }
  return false
}

export async function finalizePendingExecutionFailure(
  row: PendingExecutionClaim,
  message: string,
  durationMs: number
) {
  if (await recoverPendingExecutionCheckpoint(row)) return true
  if (row.executionType === 'document') {
    await markDocumentProcessingJobFailed(row.payload, message)
  }

  await terminalizeWorkflowExecution(row, durationMs, message)

  await cancelPendingExecutionDescendants(
    typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id
  )
  await settlePendingExecutionOwner(row, { wake: false })
}
