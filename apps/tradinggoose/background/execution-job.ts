import { executeCopilotJob } from '@/lib/copilot/agent/service'
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

export type BackgroundExecutionJob = {
  id: string
  executionType: PendingExecutionType | 'copilot'
  payload: PendingExecutionPayload
}

export async function executeBackgroundExecution(
  job: BackgroundExecutionJob,
  options: { triggerRuntime: boolean; signal?: AbortSignal }
) {
  const payload = { ...job.payload, executionId: job.id }

  switch (job.executionType) {
    case 'copilot':
      return executeCopilotJob(job.payload, options.signal)
    case 'workflow':
      if (!isWorkflowExecutionPayload(payload)) throw new Error('Invalid workflow pending payload')
      await executeWorkflowJob(payload)
      break
    case 'webhook':
      if (!isWebhookExecutionPayload(payload)) throw new Error('Invalid webhook pending payload')
      await executeWebhookJob(payload)
      break
    case 'schedule':
      if (!isScheduleExecutionPayload(payload)) throw new Error('Invalid schedule pending payload')
      await executeScheduleJob(payload)
      break
    case 'monitor':
      if (!isMonitorExecutionPayload(payload)) throw new Error('Invalid monitor pending payload')
      await executeMonitorJob(payload)
      break
    case 'document':
      return options.triggerRuntime
        ? executeTriggeredDocumentProcessingJob(job.payload)
        : executeDocumentProcessingJob(job.payload)
    default:
      throw new Error(`Unsupported background execution type: ${job.executionType}`)
  }
  // Reconciliation is queue maintenance, outside each runner's terminal-error handling.
  await reconcileWorkflowCheckpointChildren(
    typeof job.payload.resumeExecutionId === 'string' ? job.payload.resumeExecutionId : job.id
  )
}
