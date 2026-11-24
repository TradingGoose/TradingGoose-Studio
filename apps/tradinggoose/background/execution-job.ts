import { task } from '@trigger.dev/sdk'
import { backgroundTaskIds } from '@/lib/execution/background-execution'
import type {
  PendingExecutionPayload,
  PendingExecutionType,
} from '@/lib/execution/pending-execution'

type BackgroundExecutionJob = {
  id: string
  executionType: PendingExecutionType
  payload: PendingExecutionPayload
}

export function createBackgroundExecutionTask(
  executionType: PendingExecutionType,
  options: { machine?: 'large-1x' } = {}
) {
  return task({
    id: backgroundTaskIds[executionType],
    ...options,
    retry: { maxAttempts: 1 },
    run: async (payload: { pendingExecutionId: string }, { signal }) => {
      if (!payload?.pendingExecutionId || typeof payload.pendingExecutionId !== 'string')
        throw new Error('Missing pending execution ID')
      const { executePendingExecutionRun } = await import('./pending-execution-worker')
      return executePendingExecutionRun(
        { pendingExecutionId: payload.pendingExecutionId, executionType },
        signal
      )
    },
  })
}

export async function executeBackgroundExecution(
  job: BackgroundExecutionJob,
  signal?: AbortSignal,
  localDocumentNonce?: string
) {
  signal?.throwIfAborted()
  const payload = { ...job.payload, executionId: job.id }
  switch (job.executionType) {
    case 'workflow': {
      const { executeWorkflowJob, isWorkflowExecutionPayload } = await import(
        './workflow-execution'
      )
      if (!isWorkflowExecutionPayload(payload)) throw new Error('Invalid workflow pending payload')
      await executeWorkflowJob(payload, signal)
      break
    }
    case 'webhook': {
      const { executeWebhookJob, isWebhookExecutionPayload } = await import('./webhook-execution')
      if (!isWebhookExecutionPayload(payload)) throw new Error('Invalid webhook pending payload')
      await executeWebhookJob(payload, signal)
      break
    }
    case 'schedule': {
      const { executeScheduleJob, isScheduleExecutionPayload } = await import(
        './schedule-execution'
      )
      if (!isScheduleExecutionPayload(payload)) throw new Error('Invalid schedule pending payload')
      await executeScheduleJob(payload, signal)
      break
    }
    case 'monitor': {
      const { executeMonitorJob } = await import('./monitor-execution')
      await executeMonitorJob(payload, signal)
      break
    }
    case 'document': {
      const { executeDocumentProcessingJob } = await import('./knowledge-processing')
      return executeDocumentProcessingJob(job, signal, localDocumentNonce)
    }
    default:
      throw new Error(`Unsupported background execution type: ${job.executionType}`)
  }
}
