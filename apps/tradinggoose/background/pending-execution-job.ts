import type {
  PendingExecutionPayload,
  PendingExecutionType,
} from '@/lib/execution/pending-execution'
import {
  executeDocumentProcessingJob,
  executeTriggeredDocumentProcessingJob,
  markDocumentProcessingJobFailed,
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

  switch (job.executionType) {
    case 'workflow':
      if (isWorkflowExecutionPayload(payload)) return executeWorkflowJob(payload)
      throw new Error('Invalid workflow pending payload')
    case 'webhook':
      if (isWebhookExecutionPayload(payload)) return executeWebhookJob(payload)
      throw new Error('Invalid webhook pending payload')
    case 'schedule':
      if (isScheduleExecutionPayload(payload)) return executeScheduleJob(payload)
      throw new Error('Invalid schedule pending payload')
    case 'monitor':
      if (isMonitorExecutionPayload(payload)) return executeMonitorJob(payload)
      throw new Error('Invalid monitor pending payload')
    case 'document':
      try {
        return options.triggerRuntime
          ? await executeTriggeredDocumentProcessingJob(job.payload)
          : await executeDocumentProcessingJob(job.payload)
      } catch (error) {
        if (!options.triggerRuntime) {
          const message = error instanceof Error ? error.message : 'Document processing failed'
          await markDocumentProcessingJobFailed(job.payload, message)
        }
        throw error
      }
  }
}
