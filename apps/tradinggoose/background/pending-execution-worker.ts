import { db } from '@tradinggoose/db'
import { pendingExecution, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { runs, schedules, task } from '@trigger.dev/sdk'
import { eq } from 'drizzle-orm'
import {
  completePendingExecution,
  getPendingExecutionTriggerKey,
  getProcessingPendingExecution,
  isPendingExecutionPayload,
  isTierLimitedPendingExecution,
  PENDING_EXECUTION_TASK_ID,
  type PendingExecutionClaim,
  triggerPendingExecution,
  wakePendingExecution,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import type { ExecutionTrigger, WorkflowState } from '@/lib/logs/types'
import {
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
} from './knowledge-processing'
import { executeMonitorJob, isMonitorExecutionPayload } from './monitor-execution'
import { executeScheduleJob, isScheduleExecutionPayload } from './schedule-execution'
import { executeWebhookJob, isWebhookExecutionPayload } from './webhook-execution'
import { executeWorkflowJob, isWorkflowExecutionPayload } from './workflow-execution'

const logger = createLogger('PendingExecutionWorker')
const TIME_LIMIT_ERROR = 'Workflow execution time limit exceeded'
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

async function dispatchPendingExecution(row: PendingExecutionClaim): Promise<boolean> {
  switch (row.executionType) {
    case 'workflow': {
      if (!isWorkflowExecutionPayload(row.payload)) {
        throw new Error('Invalid workflow pending payload')
      }

      await executeWorkflowJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'webhook': {
      if (!isWebhookExecutionPayload(row.payload)) {
        throw new Error('Invalid webhook pending payload')
      }

      await executeWebhookJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'schedule': {
      if (!isScheduleExecutionPayload(row.payload)) {
        throw new Error('Invalid schedule pending payload')
      }

      await executeScheduleJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'monitor': {
      if (!isMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid monitor pending payload')
      }

      await executeMonitorJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'document': {
      try {
        await dispatchQueuedDocumentProcessingJob(row.payload)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'
        await failQueuedDocumentProcessingJob(row.payload, errorMessage)
        await completePendingExecution({ pendingExecutionId: row.id })
        return false
      }
      break
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }

  await completePendingExecution({ pendingExecutionId: row.id })
  return true
}

export async function executePendingExecution(payload: PendingExecutionTaskPayload) {
  const row = await getProcessingPendingExecution(payload.pendingExecutionId)
  if (!row) {
    return { success: true, skipped: 'not_processing' as const }
  }

  try {
    const success = await dispatchPendingExecution(row)
    return { success, pendingExecutionId: row.id }
  } catch (error) {
    logger.error('Pending execution failed', {
      pendingExecutionId: row.id,
      executionType: row.executionType,
      workflowId: row.workflowId,
      error,
    })
    throw error
  }
}

export const pendingExecutionTask = task({
  id: PENDING_EXECUTION_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: executePendingExecution,
})

async function getWorkflowExecutionLog(row: PendingExecutionClaim) {
  if (!isTierLimitedPendingExecution(row)) {
    return undefined
  }

  const [log] = await db
    .select({
      id: workflowExecutionLogs.id,
      endedAt: workflowExecutionLogs.endedAt,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, row.id))
    .limit(1)

  return log ?? null
}

async function terminalizeWorkflowExecution(
  row: PendingExecutionClaim,
  durationMs: number,
  message: string,
  existingLog: Awaited<ReturnType<typeof getWorkflowExecutionLog>>
) {
  if (!row.workflowId || !row.workspaceId) {
    throw new Error(`Execution ${row.id} is missing workflow scope`)
  }

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
  })
}

async function reconcileProcessingExecution(row: PendingExecutionClaim) {
  const triggerKey = getPendingExecutionTriggerKey(row.id)
  const page = await runs.list({
    tag: triggerKey,
    taskIdentifier: PENDING_EXECUTION_TASK_ID,
    limit: 1,
  })
  const run = page.data[0]

  if (!run) {
    await triggerPendingExecution(row)
    return
  }

  if (ACTIVE_RUN_STATUSES.has(run.status)) {
    return
  }

  if (run.status === 'TIMED_OUT') {
    const workflowLog = await getWorkflowExecutionLog(row)
    if (workflowLog !== undefined) {
      await terminalizeWorkflowExecution(row, run.durationMs, TIME_LIMIT_ERROR, workflowLog)
    }
  }

  // Trigger owns retries. Every terminal run releases its queue capacity exactly once.
  await completePendingExecution({ pendingExecutionId: row.id })
}

export async function recoverPendingExecutions() {
  const processingRows = await db
    .select()
    .from(pendingExecution)
    .where(eq(pendingExecution.status, 'processing'))

  let reconciledCount = 0
  await Promise.all(
    processingRows.map(async (rawRow) => {
      const row = {
        ...rawRow,
        payload: isPendingExecutionPayload(rawRow.payload) ? rawRow.payload : {},
      } as PendingExecutionClaim

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
  )

  const pendingScopes = await db
    .selectDistinct({ billingScopeId: pendingExecution.billingScopeId })
    .from(pendingExecution)
    .where(eq(pendingExecution.status, 'pending'))

  await Promise.all(
    pendingScopes.map(({ billingScopeId }) => wakePendingExecution({ billingScopeId }))
  )

  return {
    pendingScopeCount: pendingScopes.length,
    reconciledCount,
  }
}

export const pendingExecutionRecoverySweep = schedules.task({
  id: 'pending-execution-recovery-sweep',
  cron: '* * * * *',
  run: recoverPendingExecutions,
})
