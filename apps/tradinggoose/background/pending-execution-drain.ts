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
  releasePendingExecution,
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

function isPendingExecutionDeferredError(error: unknown) {
  return (
    isExecutionConcurrencyLimitError(error) ||
    isExecutionConcurrencyBackendUnavailableError(error) ||
    isLocalVmSaturationLimitError(error)
  )
}

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

    case 'indicator_monitor': {
      if (!isIndicatorMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid indicator monitor pending payload')
      }

      await executeIndicatorMonitorJob({
        ...row.payload,
        executionId: row.id,
      })
      break
    }

    case 'document': {
      await dispatchQueuedDocumentProcessingJob(row.payload)
      break
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }

  await completePendingExecution({ pendingExecutionId: row.id })
}

export async function drainPendingExecutionsForBillingScope(payload: PendingExecutionDrainPayload) {
  let pendingExecutionId: string | undefined
  let failed = false

  while (true) {
    const row = await claimNextPendingExecution(payload.billingScopeId)

    if (!row) {
      return pendingExecutionId === undefined
        ? { success: true, skipped: 'empty' as const }
        : { success: !failed, pendingExecutionId }
    }

    try {
      await dispatchPendingExecution(row)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'

      if (isPendingExecutionDeferredError(error)) {
        await releasePendingExecution({ pendingExecutionId: row.id })
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
      failed = true

      logger.error('Pending execution failed', {
        pendingExecutionId: row.id,
        executionType: row.executionType,
        workflowId: row.workflowId,
        error,
      })
    }

    pendingExecutionId = row.id
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
