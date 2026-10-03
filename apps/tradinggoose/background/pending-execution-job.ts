import type {
  PendingExecutionPayload,
  PendingExecutionType,
} from '@/lib/execution/pending-execution'
import { reconcileWorkflowCheckpointChildren } from '@/lib/workflows/human-in-the-loop/service'
import {
  executeDocumentProcessingJob,
  executeTriggeredDocumentProcessingJob,
} from './knowledge-processing'
import { executeMonitorJob, isMonitorExecutionPayload } from './monitor-execution'
import { executeScheduleJob, isScheduleExecutionPayload } from './schedule-execution'
import { executeWebhookJob, isWebhookExecutionPayload } from './webhook-execution'
import { executeWorkflowJob, isWorkflowExecutionPayload } from './workflow-execution'

type PendingExecutionJob = {
  id: string
  executionType: PendingExecutionType
  payload: PendingExecutionPayload
}

export async function executePendingExecutionJob(
  job: PendingExecutionJob,
  options: { triggerRuntime: boolean }
) {
  const payload = { ...job.payload, executionId: job.id }
  let result: unknown

  switch (job.executionType) {
    case 'workflow':
      if (!isWorkflowExecutionPayload(payload)) throw new Error('Invalid workflow pending payload')
      result = await executeWorkflowJob(payload)
      break
    case 'webhook':
      if (!isWebhookExecutionPayload(payload)) throw new Error('Invalid webhook pending payload')
      result = await executeWebhookJob(payload, job.id)
      break
    case 'schedule':
      if (!isScheduleExecutionPayload(payload)) throw new Error('Invalid schedule pending payload')
      result = await executeScheduleJob(payload)
      break
    case 'monitor':
      if (!isMonitorExecutionPayload(payload)) throw new Error('Invalid monitor pending payload')
      result = await executeMonitorJob(payload)
      break
    case 'document':
      return options.triggerRuntime
        ? executeTriggeredDocumentProcessingJob(job.payload)
        : executeDocumentProcessingJob(job.payload)
    default:
      throw new Error(`Unsupported pending execution type: ${job.executionType}`)
  }
  // Reconciliation is queue maintenance, outside each runner's terminal-error handling.
  await reconcileWorkflowCheckpointChildren(
    typeof job.payload.resumeExecutionId === 'string' ? job.payload.resumeExecutionId : job.id
  )
  return result
}
