import { db } from '@tradinggoose/db'
import { pendingExecution } from '@tradinggoose/db/schema'
import { schedules, task, timeout } from '@trigger.dev/sdk'
import { resolveServerExecutionBillingTierForScope } from '@/lib/execution/execution-concurrency-limit'
import {
  claimNextPendingExecution,
  completePendingExecution,
  PENDING_EXECUTION_DRAIN_TASK_ID,
  type PendingExecutionClaim,
} from '@/lib/execution/pending-execution'
import { wakePendingExecutionDrain } from '@/lib/execution/pending-execution-drain-wake'
import {
  createWorkflowExecutionTimePolicy,
  isWorkflowExecutionTimePolicy,
} from '@/lib/execution/workflow-execution-time-policy'
import { createLogger } from '@/lib/logs/console/logger'
import { INDICATOR_MONITOR_PROVIDER } from '@/lib/monitors/sources'
import {
  dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob,
} from './knowledge-processing'
import { executeMonitorJob, isMonitorExecutionPayload } from './monitor-execution'
import { executeScheduleJob, isScheduleExecutionPayload } from './schedule-execution'
import { executeWebhookJob, isWebhookExecutionPayload } from './webhook-execution'
import {
  executeWorkflowJob,
  isWorkflowExecutionPayload,
  type WorkflowExecutionAttemptOptions,
} from './workflow-execution'

const logger = createLogger('PendingExecutionDrain')

type PendingExecutionDrainPayload = {
  billingScopeId: string
}

async function captureWorkflowExecutionAttempt(
  row: PendingExecutionClaim
): Promise<WorkflowExecutionAttemptOptions> {
  const attemptStartedAt = row.processingStartedAt.toISOString()
  const workflowPayload =
    row.executionType === 'workflow' && isWorkflowExecutionPayload(row.payload) ? row.payload : null
  const isNestedWorkflow = workflowPayload?.metadata?.source === 'workflow_block'

  if (isNestedWorkflow) {
    const inheritedPolicy = workflowPayload.metadata?.timePolicy
    if (!isWorkflowExecutionTimePolicy(inheritedPolicy)) {
      throw new Error('Nested workflow execution is missing its authenticated time policy')
    }
    return { attemptStartedAt, timePolicy: inheritedPolicy }
  }

  const tier = await resolveServerExecutionBillingTierForScope({
    scopeId: row.billingScopeId,
    scopeType: row.billingScopeType,
  })
  return {
    attemptStartedAt,
    timePolicy: createWorkflowExecutionTimePolicy({ processingStartedAt: attemptStartedAt, tier }),
  }
}

async function dispatchPendingExecution(row: PendingExecutionClaim): Promise<boolean> {
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
        await captureWorkflowExecutionAttempt(row)
      )
      break
    }

    case 'webhook': {
      if (!isWebhookExecutionPayload(row.payload)) {
        throw new Error('Invalid webhook pending payload')
      }

      await executeWebhookJob(
        { ...row.payload, executionId: row.id },
        await captureWorkflowExecutionAttempt(row)
      )
      break
    }

    case 'schedule': {
      if (!isScheduleExecutionPayload(row.payload)) {
        throw new Error('Invalid schedule pending payload')
      }

      await executeScheduleJob(
        { ...row.payload, executionId: row.id },
        await captureWorkflowExecutionAttempt(row)
      )
      break
    }

    case 'monitor': {
      if (!isMonitorExecutionPayload(row.payload)) {
        throw new Error('Invalid monitor pending payload')
      }

      const monitorPayload = { ...row.payload, executionId: row.id }
      await executeMonitorJob(
        monitorPayload,
        monitorPayload.source === INDICATOR_MONITOR_PROVIDER
          ? undefined
          : await captureWorkflowExecutionAttempt(row)
      )
      break
    }

    case 'document': {
      try {
        await dispatchQueuedDocumentProcessingJob(row.payload)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Pending execution failed'
        await failQueuedDocumentProcessingJob(row.payload, errorMessage)
        await completePendingExecution({
          pendingExecutionId: row.id,
        })
        return false
      }
      break
    }

    default:
      throw new Error(`Unsupported pending execution type: ${row.executionType}`)
  }

  await completePendingExecution({
    pendingExecutionId: row.id,
  })
  return true
}

export async function drainPendingExecutionsForBillingScope(payload: PendingExecutionDrainPayload) {
  let claimedAny = false
  let failedAny = false
  let lastPendingExecutionId: string | undefined

  // Keep the worker responsible for the current scope until the queue is empty or capacity blocked.
  while (true) {
    const claim = await claimNextPendingExecution(payload.billingScopeId)

    if (claim.status === 'empty') {
      if (!claimedAny) {
        return { success: true, skipped: 'empty' as const }
      }
      return {
        success: !failedAny,
        pendingExecutionId: lastPendingExecutionId,
      }
    }

    if (claim.status === 'capacity_blocked') {
      return {
        success: !failedAny,
        pendingExecutionId: claim.pendingExecutionId,
      }
    }

    const row = claim.row
    claimedAny = true
    lastPendingExecutionId = row.id

    try {
      const succeeded = await dispatchPendingExecution(row)
      failedAny ||= !succeeded
    } catch (error) {
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
  maxDuration: timeout.None,
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: PendingExecutionDrainPayload) => {
    return drainPendingExecutionsForBillingScope(payload)
  },
})

export async function recoverPendingExecutionDrains() {
  const scopes = await db
    .selectDistinct({ billingScopeId: pendingExecution.billingScopeId })
    .from(pendingExecution)

  await Promise.all(
    scopes.map(({ billingScopeId }) => wakePendingExecutionDrain({ billingScopeId }))
  )

  return { recoveredScopeCount: scopes.length }
}

export const pendingExecutionRecoverySweep = schedules.task({
  id: 'pending-execution-recovery-sweep',
  cron: '*/5 * * * *',
  run: recoverPendingExecutionDrains,
})
