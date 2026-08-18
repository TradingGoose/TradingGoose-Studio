/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelPendingWorkflowExecution: vi.fn(),
  completePendingExecution: vi.fn(),
  executeDocumentProcessingJob: vi.fn(),
  executeTriggeredDocumentProcessingJob: vi.fn(),
  executeMonitorJob: vi.fn(),
  executeScheduleJob: vi.fn(),
  executeWebhookJob: vi.fn(),
  executeWorkflowJob: vi.fn(),
  markDocumentProcessingJobFailed: vi.fn(),
  getProcessingPendingExecution: vi.fn(),
  isMonitorExecutionPayload: vi.fn(),
  isScheduleExecutionPayload: vi.fn(),
  isTierLimitedPendingExecution: vi.fn(),
  isWebhookExecutionPayload: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  markPendingExecutionOwnerCompleted: vi.fn(),
  logLimit: vi.fn(),
  loggerError: vi.fn(),
  loggingCompleteWithError: vi.fn(),
  loggingSessionConstructor: vi.fn(),
  loggingStart: vi.fn(),
  runsCancel: vi.fn(),
  runsList: vi.fn(),
  task: vi.fn((config) => config),
}))

vi.mock('@trigger.dev/sdk', () => ({
  runs: { cancel: mocks.runsCancel, list: mocks.runsList },
  task: mocks.task,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.logLimit })),
      })),
    })),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  workflowExecutionLogs: {
    endedAt: 'workflowExecutionLogs.endedAt',
    executionId: 'workflowExecutionLogs.executionId',
    id: 'workflowExecutionLogs.id',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  completePendingExecution: mocks.completePendingExecution,
  getPendingExecutionTriggerKey: (id: string) => `pending-execution:${id}`,
  getProcessingPendingExecution: mocks.getProcessingPendingExecution,
  isTierLimitedPendingExecution: mocks.isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  markPendingExecutionOwnerCompleted: mocks.markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID: 'pending-execution',
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(function (...args) {
    void new.target
    mocks.loggingSessionConstructor(...args)
    return {
      completeWithError: mocks.loggingCompleteWithError,
      start: mocks.loggingStart,
    }
  }),
}))

vi.mock('@/lib/workflows/queued-execution-cancellation', () => ({
  cancelPendingWorkflowExecution: mocks.cancelPendingWorkflowExecution,
}))

vi.mock('./knowledge-processing', () => ({
  executeDocumentProcessingJob: mocks.executeDocumentProcessingJob,
  executeTriggeredDocumentProcessingJob: mocks.executeTriggeredDocumentProcessingJob,
  markDocumentProcessingJobFailed: mocks.markDocumentProcessingJobFailed,
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

import { finalizePendingExecutionFailure, pendingExecutionTask } from './pending-execution-worker'

const processingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pending-workflow-1',
  billingScopeId: 'scope-1',
  billingScopeType: 'user',
  executionType: 'workflow',
  source: 'workflow_api',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  payload: { workflowId: 'workflow-1', userId: 'user-1' },
  status: 'processing',
  nextAttemptAt: new Date('2026-08-13T16:00:00.000Z'),
  processingStartedAt: new Date('2026-08-13T16:00:00.000Z'),
  createdAt: new Date('2026-08-13T15:59:00.000Z'),
  updatedAt: new Date('2026-08-13T16:00:00.000Z'),
  ...overrides,
})

const runTask = (pendingExecutionId: string) =>
  (
    pendingExecutionTask as unknown as {
      run: (payload: { pendingExecutionId: string }) => Promise<unknown>
    }
  ).run({ pendingExecutionId })

describe('pending execution worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cancelPendingWorkflowExecution.mockResolvedValue({ status: 'cancelling' })
    mocks.completePendingExecution.mockResolvedValue(undefined)
    mocks.executeDocumentProcessingJob.mockResolvedValue(undefined)
    mocks.executeTriggeredDocumentProcessingJob.mockResolvedValue(undefined)
    mocks.executeMonitorJob.mockResolvedValue({ success: true })
    mocks.executeScheduleJob.mockResolvedValue({ success: true })
    mocks.executeWebhookJob.mockResolvedValue({ success: true })
    mocks.executeWorkflowJob.mockResolvedValue({ success: true })
    mocks.markDocumentProcessingJobFailed.mockResolvedValue(undefined)
    mocks.getProcessingPendingExecution.mockResolvedValue(null)
    mocks.isMonitorExecutionPayload.mockReturnValue(false)
    mocks.isScheduleExecutionPayload.mockReturnValue(false)
    mocks.isTierLimitedPendingExecution.mockImplementation(
      (row) => row.executionType !== 'document'
    )
    mocks.isWebhookExecutionPayload.mockReturnValue(false)
    mocks.isWorkflowExecutionPayload.mockReturnValue(true)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.markPendingExecutionOwnerCompleted.mockResolvedValue(undefined)
    mocks.logLimit.mockResolvedValue([])
    mocks.loggingCompleteWithError.mockResolvedValue(undefined)
    mocks.loggingStart.mockResolvedValue('workflow-log-1')
    mocks.runsCancel.mockResolvedValue(undefined)
    mocks.runsList.mockResolvedValue({ data: [], pagination: {} })
  })

  it('executes exactly the claimed row and releases capacity', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runTask(row.id)).resolves.toEqual({
      success: true,
      pendingExecutionId: row.id,
    })

    expect(mocks.executeWorkflowJob).toHaveBeenCalledWith({
      ...row.payload,
      executionId: row.id,
    })
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
  })

  it('persists a terminal error and still reports the Trigger run as failed', async () => {
    const row = processingRow()
    const error = new Error('Execution infrastructure failed')
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeWorkflowJob.mockRejectedValueOnce(error)

    await expect(runTask(row.id)).rejects.toThrow(error.message)

    expect(mocks.loggingCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({ error: { message: error.message } })
    )
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({ pendingExecutionId: row.id })
  })

  it('terminalizes a failed Airtable continuation admission', async () => {
    const row = processingRow({
      executionType: 'webhook',
      source: 'webhook:airtable',
      payload: { provider: 'airtable', phase: 'initial' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.isWebhookExecutionPayload.mockReturnValue(true)
    mocks.executeWebhookJob.mockRejectedValueOnce(new Error('Continuation admission failed'))

    await expect(runTask(row.id)).rejects.toThrow('Continuation admission failed')

    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
  })

  it('keeps a completed parent as the capacity owner while a child is active', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValueOnce([
      processingRow({ id: 'child-1', source: 'workflow_block' }),
    ])

    await expect(runTask(row.id)).resolves.toMatchObject({ success: true })

    expect(mocks.markPendingExecutionOwnerCompleted).toHaveBeenCalledWith(row)
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })

  it('records document dispatch failure before releasing capacity', async () => {
    const row = processingRow({
      id: 'pending-document-1',
      executionType: 'document',
      workflowId: null,
      workspaceId: null,
      payload: { documentId: 'document-1' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeTriggeredDocumentProcessingJob.mockRejectedValueOnce(new Error('PDF parse failed'))

    await expect(runTask(row.id)).rejects.toThrow('PDF parse failed')
    expect(mocks.markDocumentProcessingJobFailed).toHaveBeenCalledWith(
      row.payload,
      'PDF parse failed'
    )
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({ pendingExecutionId: row.id })
  })

  it('settles reconciled failures without starting a nested queue wake', async () => {
    const row = processingRow()

    await finalizePendingExecutionFailure(row as any, 'Timed out', 1_000, { wake: false })

    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
      wake: false,
    })
  })

  it('retains parent capacity until a processing child is gone', async () => {
    const parent = processingRow()
    const child = processingRow({ id: 'child-1', source: 'workflow_block' })
    let parentReads = 0
    mocks.listChildPendingWorkflowExecutions.mockImplementation((id) => {
      if (id === child.id) return Promise.resolve([])
      parentReads += 1
      return Promise.resolve([child])
    })
    mocks.runsList.mockResolvedValueOnce({
      data: [
        {
          id: 'run-EXECUTING',
          status: 'EXECUTING',
          durationMs: 1_000,
          isCompleted: false,
          isCancelled: false,
        },
      ],
      pagination: {},
    })

    await expect(
      finalizePendingExecutionFailure(parent as any, 'Parent failed', 1_000, { wake: false })
    ).resolves.toBe(false)

    expect(parentReads).toBe(2)
    expect(mocks.cancelPendingWorkflowExecution).toHaveBeenCalledWith({
      pendingExecutionId: child.id,
      userId: child.userId,
      wake: false,
    })
    expect(mocks.runsCancel).toHaveBeenCalledWith('run-EXECUTING')
    expect(mocks.markPendingExecutionOwnerCompleted).toHaveBeenCalledWith(parent, { wake: false })
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })
})
