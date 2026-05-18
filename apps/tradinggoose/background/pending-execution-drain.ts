import { task } from '@trigger.dev/sdk'
import {
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
} from '@/lib/execution/execution-concurrency-limit'
import { isLocalVmSaturationLimitError } from '@/lib/execution/local-saturation-limit'
import {
  claimNextPendingExecution,
  completePendingExecution,
  PENDING_EXECUTION_DRAIN_TASK_ID,
  type PendingExecutionClaim,
  retryPendingExecution,
  triggerPendingExecutionDrain,
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

const isTransientPendingExecutionError = (error: unknown) =>
  isExecutionConcurrencyLimitError(error) ||
  isExecutionConcurrencyBackendUnavailableError(error) ||
  isLocalVmSaturationLimitError(error) ||
  (error instanceof Error && error.message.includes('Service overloaded'))

async function dispatchPendingExecution(row: PendingExecutionClaim) {
  switch (row.executionType) {
    case 'workflow': {
      if (!isWorkflowExecutionPayload(row.payload)) {
        throw new Error('Invalid workflow pending payload')
      }

      await executeWorkflowJob({
        ...row.payload,
        executionId: row.id,
      })
      await completePendingExecution({
        pendingExecutionId: row.id,
      })
      return
    }

    case 'webhook': {
      if (!isWebhookExecutionPayload(row.payload)) {
        throw new Error('Invalid webhook pending payload')
      }

      await executeWebhookJob({
        ...row.payload,
        executionId: row.id,
      })
      await completePendingExecution({
        pendingExecutionId: row.id,
      })
      return
    }

    case 'schedule': {
      if (!isScheduleExecutionPayload(row.payload)) {
        throw new Error('Invalid schedule pending payload')
      }

      await executeScheduleJob({
        ...row.payload,
        executionId: row.id,
      })
      await completePendingExecution({
        pendingExecutionId: row.id,
      })
      return
    }

    case 'indicator_monitor': {
      if (!isIndicatorMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid indicator monitor pending payload')
      }

      await executeIndicatorMonitorJob({
        ...row.payload,
        executionId: row.id,
      })
      await completePendingExecution({
        pendingExecutionId: row.id,
      })
      return
    }

    case 'document': {
      await dispatchQueuedDocumentProcessingJob(row.payload)
      await completePendingExecution({ pendingExecutionId: row.id })
      return
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }
}

async function wakeNextPendingExecutionDrain(row: PendingExecutionClaim) {
  await triggerPendingExecutionDrain({ billingScopeId: row.billingScopeId }).catch((error) => {
    logger.error('Failed to wake next pending execution drain', {
      billingScopeId: row.billingScopeId,
      pendingExecutionId: row.id,
      error,
    })
  })
}

export async function drainPendingExecutionsForBillingScope(payload: PendingExecutionDrainPayload) {
  const row = await claimNextPendingExecution(payload.billingScopeId)

  if (!row) {
    return { success: true, skipped: 'empty' as const }
  }

  try {
    await dispatchPendingExecution(row)
    await wakeNextPendingExecutionDrain(row)
    return {
      success: true,
      pendingExecutionId: row.id,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'

    if (isTransientPendingExecutionError(error)) {
      await retryPendingExecution({
        pendingExecutionId: row.id,
        errorMessage,
      })
      return {
        success: true,
        pendingExecutionId: row.id,
        skipped: 'deferred' as const,
      }
    }

    if (row.executionType === 'document') {
      await failQueuedDocumentProcessingJob(row.payload, errorMessage)
    }
    await completePendingExecution({ pendingExecutionId: row.id })
    await wakeNextPendingExecutionDrain(row)

    logger.error('Pending execution failed', {
      pendingExecutionId: row.id,
      executionType: row.executionType,
      workflowId: row.workflowId,
      error,
    })

    return {
      success: false,
      pendingExecutionId: row.id,
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
