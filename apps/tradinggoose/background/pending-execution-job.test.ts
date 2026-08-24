import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeDocumentProcessingJob: vi.fn(),
  executeMonitorJob: vi.fn(),
  executeScheduleJob: vi.fn(),
  executeTriggeredDocumentProcessingJob: vi.fn(),
  executeWebhookJob: vi.fn(),
  executeWorkflowJob: vi.fn(),
  isMonitorExecutionPayload: vi.fn(),
  isScheduleExecutionPayload: vi.fn(),
  isWebhookExecutionPayload: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(),
}))

vi.mock('./knowledge-processing', () => ({
  executeDocumentProcessingJob: mocks.executeDocumentProcessingJob,
  executeTriggeredDocumentProcessingJob: mocks.executeTriggeredDocumentProcessingJob,
}))

vi.mock('./monitor-execution', () => ({
  executeMonitorJob: mocks.executeMonitorJob,
  isMonitorExecutionPayload: mocks.isMonitorExecutionPayload,
}))

vi.mock('./schedule-execution', () => ({
  executeScheduleJob: mocks.executeScheduleJob,
  isScheduleExecutionPayload: mocks.isScheduleExecutionPayload,
}))

vi.mock('./webhook-execution', () => ({
  executeWebhookJob: mocks.executeWebhookJob,
  isWebhookExecutionPayload: mocks.isWebhookExecutionPayload,
}))

vi.mock('./workflow-execution', () => ({
  executeWorkflowJob: mocks.executeWorkflowJob,
  isWorkflowExecutionPayload: mocks.isWorkflowExecutionPayload,
}))

import { executePendingExecutionJob } from './pending-execution-job'

const documentPayload = {
  knowledgeBaseId: 'knowledge-base-1',
  documentId: 'document-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  docData: {
    filename: 'document.pdf',
    fileUrl: 'https://example.com/document.pdf',
    fileSize: 100,
    mimeType: 'application/pdf',
  },
  processingOptions: {
    chunkSize: 512,
    minCharactersPerChunk: 24,
    chunkOverlap: 100,
  },
  requestId: 'request-1',
}

describe('pending execution job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeDocumentProcessingJob.mockResolvedValue(undefined)
    mocks.executeTriggeredDocumentProcessingJob.mockResolvedValue(undefined)
    mocks.executeWebhookJob.mockResolvedValue(undefined)
    mocks.isWebhookExecutionPayload.mockReturnValue(false)
    mocks.isWorkflowExecutionPayload.mockReturnValue(false)
  })

  it('executes documents directly when Trigger is disabled', async () => {
    await executePendingExecutionJob(
      { id: 'document-job-1', executionType: 'document', payload: documentPayload },
      { triggerRuntime: false }
    )

    expect(mocks.executeDocumentProcessingJob).toHaveBeenCalledWith(documentPayload)
    expect(mocks.executeTriggeredDocumentProcessingJob).not.toHaveBeenCalled()
  })

  it('uses the document Trigger task only inside the Trigger worker', async () => {
    await executePendingExecutionJob(
      { id: 'document-job-1', executionType: 'document', payload: documentPayload },
      { triggerRuntime: true }
    )

    expect(mocks.executeTriggeredDocumentProcessingJob).toHaveBeenCalledWith(documentPayload)
    expect(mocks.executeDocumentProcessingJob).not.toHaveBeenCalled()
  })

  it('propagates direct document failures to the local caller', async () => {
    const error = new Error('Document parsing failed')
    mocks.executeDocumentProcessingJob.mockRejectedValueOnce(error)

    await expect(
      executePendingExecutionJob(
        { id: 'document-job-1', executionType: 'document', payload: documentPayload },
        { triggerRuntime: false }
      )
    ).rejects.toThrow(error.message)
  })

  it('declares pending-row ownership for webhook execution', async () => {
    const payload = {
      webhookId: 'webhook-1',
      workflowId: 'workflow-1',
      userId: 'user-1',
      provider: 'airtable',
    }
    mocks.isWebhookExecutionPayload.mockReturnValue(true)

    await executePendingExecutionJob(
      { id: 'webhook-job-1', executionType: 'webhook', payload },
      { triggerRuntime: false }
    )

    expect(mocks.executeWebhookJob).toHaveBeenCalledWith(
      { ...payload, executionId: 'webhook-job-1' },
      'webhook-job-1'
    )
  })

  it('passes the pending execution identifier to workflow execution', async () => {
    const payload = { workflowId: 'workflow-1' }
    mocks.isWorkflowExecutionPayload.mockReturnValue(true)

    await executePendingExecutionJob(
      { id: 'workflow-job-1', executionType: 'workflow', payload },
      { triggerRuntime: true }
    )

    expect(mocks.executeWorkflowJob).toHaveBeenCalledWith({
      ...payload,
      executionId: 'workflow-job-1',
    })
  })
})
