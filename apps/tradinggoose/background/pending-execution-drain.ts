import { task } from '@trigger.dev/sdk'
import {
  type ExecutionConcurrencyController,
  withExecutionConcurrencyController,
} from '@/lib/execution/execution-concurrency-limit'
import {
  claimNextPendingExecution,
  completePendingExecution,
  deferPendingExecutionStart,
  isPendingExecutionCapacityBlockedError,
  PENDING_EXECUTION_DRAIN_TASK_ID,
  type PendingExecutionClaim,
} from '@/lib/execution/pending-execution'
import { createLogger } from '@/lib/logs/console/logger'
import {
  executeIndicatorMonitorJob,
  isIndicatorMonitorExecutionPayload,
} from './indicator-monitor-execution'
import {
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
} from './knowledge-processing'
import { executeScheduleJob, isScheduleExecutionPayload } from './schedule-execution'
import { executeWebhookJob, isWebhookExecutionPayload } from './webhook-execution'
import { executeWorkflowJob, isWorkflowExecutionPayload } from './workflow-execution'

const logger = createLogger('PendingExecutionDrain')

type PendingExecutionDrainPayload = {
  billingScopeId: string
}

async function dispatchPendingExecution(
  row: PendingExecutionClaim,
  executionConcurrencyController: ExecutionConcurrencyController
) {
  switch (row.executionType) {
    case 'workflow': {
      if (!isWorkflowExecutionPayload(row.payload)) {
        throw new Error('Invalid workflow pending payload')
      }

      await executeWorkflowJob(
        {
          ...row.payload,
          executionId: row.id,
        },
        { executionConcurrencyController }
      )
      break
    }

    case 'webhook': {
      if (!isWebhookExecutionPayload(row.payload)) {
        throw new Error('Invalid webhook pending payload')
      }

      await executeWebhookJob(
        {
          ...row.payload,
          executionId: row.id,
        },
        { executionConcurrencyController }
      )
      break
    }

    case 'schedule': {
      if (!isScheduleExecutionPayload(row.payload)) {
        throw new Error('Invalid schedule pending payload')
      }

      await executeScheduleJob(
        {
          ...row.payload,
          executionId: row.id,
        },
        { executionConcurrencyController }
      )
      break
    }

    case 'indicator_monitor': {
      if (!isIndicatorMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid indicator monitor pending payload')
      }

      await executeIndicatorMonitorJob(
        {
          ...row.payload,
          executionId: row.id,
        },
        { executionConcurrencyController }
      )
      break
    }

    case 'document': {
      await dispatchQueuedDocumentProcessingJob(row.payload)
      break
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }

  await completePendingExecution({
    pendingExecutionId: row.id,
  })
}

export async function drainPendingExecutionsForBillingScope(payload: PendingExecutionDrainPayload) {
  let claimedAny = false
  let failedAny = false
  let lastPendingExecutionId: string | undefined

  // Keep the worker responsible for the current scope until the queue is empty or capacity blocked.
  while (true) {
    const row = await claimNextPendingExecution(payload.billingScopeId)

    if (!row) {
      if (!claimedAny) {
        return { success: true, skipped: 'empty' as const }
      }
      return {
        success: !failedAny,
        pendingExecutionId: lastPendingExecutionId,
      }
    }

    claimedAny = true
    lastPendingExecutionId = row.id

    try {
      await withExecutionConcurrencyController({
        billingScopeId: row.billingScopeId,
        billingScopeType: row.billingScopeType,
        task: (executionConcurrencyController) =>
          dispatchPendingExecution(row, executionConcurrencyController),
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'

      if (isPendingExecutionCapacityBlockedError(error)) {
        await deferPendingExecutionStart({
          pendingExecutionId: row.id,
        })
        return {
          success: !failedAny,
          pendingExecutionId: row.id,
        }
      }

      if (row.executionType === 'document') {
        await failQueuedDocumentProcessingJob(row.payload, errorMessage)
      }
      await completePendingExecution({
        pendingExecutionId: row.id,
      })
      failedAny = true

      logger.error('Pending execution failed', {
        pendingExecutionId: row.id,
        executionType: row.executionType,
        workflowId: row.workflowId,
        error,
      })
    }
  }
}

export const pendingExecutionDrain = task({
  id: PENDING_EXECUTION_DRAIN_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: PendingExecutionDrainPayload) => {
    return drainPendingExecutionsForBillingScope(payload)
  },
})
