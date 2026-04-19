import { task, wait } from '@trigger.dev/sdk'
import {
  isExecutionConcurrencyBackendUnavailableError,
  isExecutionConcurrencyLimitError,
} from '@/lib/execution/execution-concurrency-limit'
import { isLocalVmSaturationLimitError } from '@/lib/execution/local-saturation-limit'
import { createLogger } from '@/lib/logs/console/logger'
import {
  claimNextPendingExecution,
  completePendingExecution,
  failPendingExecution,
  type PendingExecutionClaim,
  PENDING_EXECUTION_DRAIN_TASK_ID,
  PENDING_EXECUTION_RETRY_DELAY_MS,
  retryPendingExecution,
} from '@/lib/execution/pending-execution'
import {
  executeDocumentProcessingJob,
  isDocumentProcessingPayload,
} from './knowledge-processing'
import {
  executeIndicatorMonitorJob,
  isIndicatorMonitorExecutionPayload,
} from './indicator-monitor-execution'
import {
  executeScheduleJob,
  isScheduleExecutionPayload,
} from './schedule-execution'
import {
  executeWebhookJob,
  isWebhookExecutionPayload,
} from './webhook-execution'
import {
  executeWorkflowJob,
  isWorkflowExecutionPayload,
} from './workflow-execution'

const logger = createLogger('PendingExecutionDrain')

type PendingExecutionDrainPayload = {
  billingScopeId: string
}

type PendingExecutionDrainOptions = {
  waitForRetry?: (delayMs: number) => Promise<void>
}

const sleep = (delayMs: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })

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

      const result = await executeWorkflowJob({
        ...row.payload,
        executionId: row.id,
      })
      await completePendingExecution({
        pendingExecutionId: row.id,
        deleteOnSuccess: false,
        result,
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
      if (!isDocumentProcessingPayload(row.payload)) {
        throw new Error('Invalid document pending payload')
      }

      await executeDocumentProcessingJob(row.payload)
      await completePendingExecution({ pendingExecutionId: row.id })
      return
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }
}

export async function drainPendingExecutionsForBillingScope(
  payload: PendingExecutionDrainPayload,
  options: PendingExecutionDrainOptions = {},
) {
  let lastPendingExecutionId: string | undefined
  let hadFailure = false
  let wasDeferred = false
  let hasDeferredWork = false
  const waitForRetry = options.waitForRetry ?? sleep

  while (true) {
    const row = await claimNextPendingExecution(payload.billingScopeId)

    if (!row) {
      if (hasDeferredWork) {
        hasDeferredWork = false
        await waitForRetry(PENDING_EXECUTION_RETRY_DELAY_MS)
        continue
      }

      if (!lastPendingExecutionId) {
        return { success: true, skipped: 'empty' as const }
      }

      return {
        success: !hadFailure,
        pendingExecutionId: lastPendingExecutionId,
        ...(wasDeferred ? { skipped: 'deferred' as const } : {}),
      }
    }

    lastPendingExecutionId = row.id

    try {
      await dispatchPendingExecution(row)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Pending execution failed'

      if (isTransientPendingExecutionError(error)) {
        await retryPendingExecution({
          pendingExecutionId: row.id,
          errorMessage,
          delayMs: PENDING_EXECUTION_RETRY_DELAY_MS,
        })
        wasDeferred = true
        hasDeferredWork = true
        continue
      }

      await failPendingExecution({
        pendingExecutionId: row.id,
        errorMessage,
      })

      logger.error('Pending execution failed', {
        pendingExecutionId: row.id,
        executionType: row.executionType,
        workflowId: row.workflowId,
        error,
      })

      hadFailure = true
    }
  }
}

export const pendingExecutionDrain = task({
  id: PENDING_EXECUTION_DRAIN_TASK_ID,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: PendingExecutionDrainPayload) => {
    return drainPendingExecutionsForBillingScope(payload, {
      waitForRetry: (delayMs) => wait.for({ seconds: delayMs / 1000 }),
    })
  },
})
