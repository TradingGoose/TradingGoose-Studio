import { db } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { AbortTaskRunError, timeout, wait } from '@trigger.dev/sdk'
import { and, eq } from 'drizzle-orm'
import {
  type BackgroundExecutionTaskPayload,
  waitForBackgroundExecution,
} from '@/lib/execution/background-execution'
import {
  finalizeCancelledPendingWorkflow,
  getProcessingPendingExecution,
  isWorkflowPendingExecution,
  listChildPendingWorkflowExecutions,
  PENDING_EXECUTION_CANCELLATION_ERROR,
  PENDING_EXECUTION_FAILURE_ERROR,
  PENDING_EXECUTION_TIME_LIMIT_ERROR,
  type PendingExecutionClaim,
  settlePendingExecutionOwner,
  wakePendingExecution,
} from '@/lib/execution/pending-execution'
import { createWorkflowExecutionResultFromLog } from '@/lib/execution/workflow-execution-events'
import { createLogger } from '@/lib/logs/console/logger'
import type { ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import { executeBackgroundExecution } from './execution-job'

const logger = createLogger('PendingExecutionWorker')
const DESCENDANT_CANCELLATION_CONCURRENCY = 5
const PENDING_EXECUTION_WAKE_RETRY_SECONDS = 30

export type PendingExecutionTaskPayload = {
  pendingExecutionId: string
  billingScopeId: string
  billingScopeType: string
  executionMaxDuration?: number
  cancelledWorkflowDurationMs?: number
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

export async function executePendingExecutionRun(
  payload: Exclude<BackgroundExecutionTaskPayload, { executionType: 'copilot' }>,
  signal?: AbortSignal,
  localDocumentNonce?: string
) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }

  if (row.executionType !== payload.executionType) throw new Error('Execution task type differs')
  if (typeof row.payload.ownerCompletedAt === 'string')
    return { success: true, pendingExecutionId: row.id, skipped: 'owner_completed' as const }
  if (!(await recoverPendingExecutionCheckpoint(row))) {
    if (typeof row.payload.cancelRequestedAt === 'string' && isWorkflowPendingExecution(row))
      throw new Error(PENDING_EXECUTION_CANCELLATION_ERROR)
    if (
      row.executionType === 'document' &&
      ((row.billingScopeType === 'local') !== Boolean(localDocumentNonce) ||
        row.payload.localDocumentNonce !== localDocumentNonce)
    )
      throw new Error('Document execution owner differs')
    await executeBackgroundExecution(row, signal, localDocumentNonce)
    if (isWorkflowPendingExecution(row)) {
      const { reconcileWorkflowCheckpointChildren } = await import(
        '@/lib/workflows/human-in-the-loop/service'
      )
      await reconcileWorkflowCheckpointChildren(
        typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id
      )
    }
  }
  // The workflow cancellation hook hands retirement and the queue wake to an independent run.
  if (row.executionType !== 'document' && !(row.executionType === 'workflow' && signal?.aborted))
    await settlePendingExecutionOwner(row, { wake: false })
  return { success: true, pendingExecutionId: row.id }
}

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

export async function finalizePendingExecutionRunFailure(
  payload: Pick<PendingExecutionTaskPayload, 'pendingExecutionId' | 'executionMaxDuration'>,
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
  if ((await finalizePendingExecutionFailure(row, message, durationMs)) === true) return undefined
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

export async function executePendingExecution(payload: PendingExecutionTaskPayload) {
  if (payload.cancelledWorkflowDurationMs !== undefined) {
    await finalizeCancelledPendingWorkflow(
      payload.pendingExecutionId,
      payload.cancelledWorkflowDurationMs
    )
    await wakePendingExecutionUntilSuccessful(payload)
    return { success: true, pendingExecutionId: payload.pendingExecutionId }
  }
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
  const result = await waitForBackgroundExecution(row, payload.executionMaxDuration ?? timeout.None)

  const failureMessage = result.ok
    ? undefined
    : await finalizePendingExecutionRunFailure(payload, result.error, startedAt)
  await wakePendingExecutionUntilSuccessful(payload)
  if (failureMessage) throw new AbortTaskRunError(failureMessage)
  return result.ok ? result.output : { success: true, skipped: 'not_processing' as const }
}

export async function terminalizeWorkflowExecution(
  row: Pick<
    PendingExecutionClaim,
    'id' | 'executionType' | 'source' | 'workflowId' | 'workspaceId' | 'userId' | 'payload'
  >,
  durationMs: number,
  message: string,
  billable = true
) {
  if (!isWorkflowPendingExecution(row)) return
  if (!row.workflowId || !row.workspaceId) {
    logger.error('Pending execution is missing workflow scope during failure finalization', {
      pendingExecutionId: row.id,
      workflowId: row.workflowId,
      workspaceId: row.workspaceId,
    })
    return
  }

  const [{ executionLogger }, { LoggingSession }, { buildTraceSpans }, checkpoints] =
    await Promise.all([
      import('@/lib/logs/execution/logger'),
      import('@/lib/logs/execution/logging-session'),
      import('@/lib/logs/execution/trace-spans/trace-spans'),
      import('@/lib/workflows/human-in-the-loop/service'),
    ])
  const { completeWorkflowCheckpointChild, readWorkflowCheckpointSnapshot } = checkpoints
  const executionId =
    typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id
  const [existingLog] = await db
    .select({
      id: workflowExecutionLogs.id,
      level: workflowExecutionLogs.level,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workspaceId, row.workspaceId)
      )
    )
    .limit(1)
  if (existingLog?.endedAt) {
    await executionLogger.settleWorkflowExecutionUsage(executionId)
    const { result } = createWorkflowExecutionResultFromLog(existingLog)
    await completeWorkflowCheckpointChild({
      childExecutionId: executionId,
      input: { ...result },
    })
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
      billable,
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
  const [{ readWorkflowCheckpointChildren }, { cancelPendingWorkflowExecution }] =
    await Promise.all([
      import('@/lib/workflows/human-in-the-loop/service'),
      import('@/lib/workflows/queued-execution-cancellation'),
    ])
  const checkpointChildren = await readWorkflowCheckpointChildren(parentExecutionId)
  const children = [
    ...new Map(
      [...queuedChildren, ...checkpointChildren].map((child) => [child.id, child])
    ).values(),
  ]
  await mapWithConcurrency(children, DESCENDANT_CANCELLATION_CONCURRENCY, async (child) => {
    if (visited.has(child.id)) return
    await cancelPendingWorkflowExecution({
      pendingExecutionId: child.id,
      userId: child.userId,
      wake: false,
      descendantCancellation: true,
    })
    await cancelPendingExecutionDescendants(child.id, visited)
  })
}

async function recoverPendingExecutionCheckpoint(row: PendingExecutionClaim) {
  if (!isWorkflowPendingExecution(row)) return false
  const { recoverWorkflowCheckpointSegment } = await import(
    '@/lib/workflows/human-in-the-loop/service'
  )
  if (
    await recoverWorkflowCheckpointSegment({
      executionId:
        typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id,
      userId: row.userId,
      workflowId: row.workflowId,
      checkpointRevision:
        typeof row.payload.checkpointRevision === 'number' ? row.payload.checkpointRevision : 0,
    })
  ) {
    if (row.executionType === 'schedule') {
      const { isScheduleExecutionPayload, settleScheduleOccurrence } = await import(
        './schedule-execution'
      )
      if (!isScheduleExecutionPayload(row.payload)) throw new Error('Invalid schedule payload')
      await settleScheduleOccurrence(row.payload, 'success')
    }
    return true
  }
  return false
}

export async function finalizePendingExecutionFailure(
  row: PendingExecutionClaim,
  message: string,
  durationMs: number
) {
  if (await recoverPendingExecutionCheckpoint(row)) {
    await settlePendingExecutionOwner(row, { wake: false })
    return true
  }
  if (row.executionType === 'document') {
    const { failDocumentAttempt } = await import('@/lib/knowledge/documents/claim')
    return (await failDocumentAttempt({ id: row.id }, message)) ? ('retired' as const) : undefined
  }

  if (isWorkflowPendingExecution(row)) {
    await terminalizeWorkflowExecution(row, durationMs, message)
    await cancelPendingExecutionDescendants(
      typeof row.payload.resumeExecutionId === 'string' ? row.payload.resumeExecutionId : row.id
    )
  }
  await settlePendingExecutionOwner(row, { wake: false })
}
