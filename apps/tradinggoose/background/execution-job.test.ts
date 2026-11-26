import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeCopilotJob: vi.fn(),
  finalizeCopilotJob: vi.fn(),
  executeDocumentProcessingJob: vi.fn(),
  executeMonitorJob: vi.fn(),
  executePendingExecutionRun: vi.fn(),
  requestCancelledWorkflowSettlement: vi.fn(),
  withPendingWorkflowExecution: vi.fn((_id: string, run: () => Promise<unknown>) => run()),
  executeScheduleJob: vi.fn(),
  executeWebhookJob: vi.fn(),
  executeWorkflowJob: vi.fn(),
  isScheduleExecutionPayload: vi.fn(),
  isWebhookExecutionPayload: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({ task: (config: unknown) => config }))
vi.mock('@/lib/copilot/agent/worker', () => ({
  executeCopilotJob: mocks.executeCopilotJob,
  finalizeCopilotExecution: mocks.finalizeCopilotJob,
}))

vi.mock('./knowledge-processing', () => ({
  executeDocumentProcessingJob: mocks.executeDocumentProcessingJob,
}))

vi.mock('./monitor-execution', () => ({
  executeMonitorJob: mocks.executeMonitorJob,
}))
vi.mock('./pending-execution-worker', () => ({
  executePendingExecutionRun: mocks.executePendingExecutionRun,
}))
vi.mock('@/lib/execution/pending-execution', () => ({
  requestCancelledWorkflowSettlement: mocks.requestCancelledWorkflowSettlement,
  withPendingWorkflowExecution: mocks.withPendingWorkflowExecution,
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

import { createBackgroundExecutionTask, executeBackgroundExecution } from './execution-job'
import { copilotExecutionTask } from './tasks/copilot-execution'

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

describe('background execution job', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.executeDocumentProcessingJob.mockResolvedValue(undefined)
    mocks.executeWebhookJob.mockResolvedValue(undefined)
    mocks.isWebhookExecutionPayload.mockReturnValue(false)
    mocks.isWorkflowExecutionPayload.mockReturnValue(false)
  })

  it('passes native cancellation through the task and document dispatch', async () => {
    const signal = new AbortController().signal
    const task = createBackgroundExecutionTask('document') as any
    const payload = { pendingExecutionId: 'document-job-1', executionType: 'document' }
    await task.run({ pendingExecutionId: payload.pendingExecutionId }, { signal })
    expect(mocks.executePendingExecutionRun).toHaveBeenCalledWith(payload, signal)
    await executeBackgroundExecution(
      { id: 'document-job-1', executionType: 'document', payload: documentPayload },
      signal
    )

    expect(mocks.executeDocumentProcessingJob).toHaveBeenCalledWith(
      { id: payload.pendingExecutionId, executionType: 'document', payload: documentPayload },
      signal,
      undefined
    )
  })

  it('runs Copilot directly with its cancellation signal', async () => {
    const payload = { runId: 'run-1' }
    const signal = new AbortController().signal
    await (copilotExecutionTask as any).run(
      { id: 'copilot-job', executionType: 'copilot', payload },
      { signal }
    )
    expect(mocks.executeCopilotJob).toHaveBeenCalledWith(payload, signal)
  })

  it('acknowledges Trigger cancellation only after the workflow workload drains', async () => {
    const task = createBackgroundExecutionTask('workflow') as any
    const payload = {
      pendingExecutionId: 'stopped',
      billingScopeType: 'user',
      billingScopeId: 'scope',
    }
    let terminate!: (error: Error) => void
    mocks.executePendingExecutionRun.mockReturnValueOnce(
      new Promise<void>((_, reject) => {
        terminate = reject
      })
    )
    const controller = new AbortController()
    const runPromise = task.run(payload, { signal: controller.signal })
    await vi.waitFor(() => expect(mocks.executePendingExecutionRun).toHaveBeenCalledOnce())
    const ctx = { attempt: { startedAt: new Date() } }
    controller.abort()
    const cancellation = task.onCancel({ payload, ctx, runPromise })
    await Promise.resolve()
    expect(mocks.requestCancelledWorkflowSettlement).not.toHaveBeenCalled()
    terminate(new Error('aborted'))
    await expect(runPromise).rejects.toThrow('aborted')
    await cancellation
    expect(mocks.withPendingWorkflowExecution).toHaveBeenCalledExactlyOnceWith(
      'stopped',
      expect.any(Function)
    )
    expect(mocks.requestCancelledWorkflowSettlement).toHaveBeenCalledExactlyOnceWith(
      'stopped',
      payload,
      expect.any(Number)
    )
  })

  it('finalizes Copilot task failure and waits for cancellation drainage', async () => {
    const payload = { id: 'copilot-job', executionType: 'copilot', payload: { runId: 'run' } }
    const task = copilotExecutionTask as any
    await task.onFailure({ payload, error: new Error('MAX_DURATION_EXCEEDED') })
    expect(mocks.finalizeCopilotJob).toHaveBeenCalledWith(payload.payload, 'MAX_DURATION_EXCEEDED')
    mocks.finalizeCopilotJob.mockClear()
    let drain!: () => void
    const runPromise = new Promise<void>((resolve) => {
      drain = resolve
    })
    const cancellation = task.onCancel({ payload, runPromise })
    expect(mocks.finalizeCopilotJob).not.toHaveBeenCalled()
    drain()
    await cancellation
    expect(mocks.finalizeCopilotJob).toHaveBeenCalledWith(
      payload.payload,
      'Copilot execution was cancelled'
    )
    expect(task).not.toHaveProperty('maxDuration')
    expect(task.retry).toEqual({ maxAttempts: 1 })
  })

  it('propagates direct document failures to the local caller', async () => {
    const error = new Error('Document parsing failed')
    mocks.executeDocumentProcessingJob.mockRejectedValueOnce(error)

    await expect(
      executeBackgroundExecution({
        id: 'document-job-1',
        executionType: 'document',
        payload: documentPayload,
      })
    ).rejects.toThrow(error.message)
  })

  it.each(['workflow', 'webhook', 'schedule', 'monitor'] as const)(
    'passes native cancellation and execution identity to %s',
    async (executionType) => {
      const payload = { workflowId: 'workflow-1' }
      const signal = new AbortController().signal
      mocks.isWorkflowExecutionPayload.mockReturnValue(true)
      mocks.isWebhookExecutionPayload.mockReturnValue(true)
      mocks.isScheduleExecutionPayload.mockReturnValue(true)
      await executeBackgroundExecution({ id: 'queued-job', executionType, payload }, signal)
      const runner = {
        workflow: mocks.executeWorkflowJob,
        webhook: mocks.executeWebhookJob,
        schedule: mocks.executeScheduleJob,
        monitor: mocks.executeMonitorJob,
      }[executionType]
      expect(runner).toHaveBeenCalledWith({ ...payload, executionId: 'queued-job' }, signal)
    }
  )
})
