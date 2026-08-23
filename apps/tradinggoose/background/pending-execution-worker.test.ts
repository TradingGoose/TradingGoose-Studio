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
  triggerAndWait: vi.fn(),
  task: vi.fn((config) => ({ ...config, triggerAndWait: mocks.triggerAndWait })),
}))

vi.mock('@trigger.dev/sdk', () => ({
  runs: { cancel: mocks.runsCancel, list: mocks.runsList },
  task: mocks.task,
  timeout: { None: 2_147_483_647 },
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
  isTerminalPendingExecutionRunStatus: (status: string) =>
    [
      'COMPLETED',
      'CANCELED',
      'FAILED',
      'CRASHED',
      'SYSTEM_FAILURE',
      'EXPIRED',
      'TIMED_OUT',
    ].includes(status),
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  markPendingExecutionOwnerCompleted: mocks.markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID: 'pending-execution',
  PENDING_EXECUTION_TIME_LIMIT_ERROR: 'Workflow execution time limit exceeded',
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

import {
  finalizePendingExecutionFailure,
  pendingExecutionRunTask,
  pendingExecutionTask,
} from './pending-execution-worker'

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

const runExecution = (pendingExecutionId: string) =>
  (
    pendingExecutionRunTask as unknown as {
      run: (payload: { pendingExecutionId: string }) => Promise<unknown>
    }
  ).run({ pendingExecutionId })

const runSupervisor = (pendingExecutionId: string, executionMaxDuration?: number) =>
  (
    pendingExecutionTask as unknown as {
      run: (payload: {
        pendingExecutionId: string
        executionMaxDuration?: number
      }) => Promise<unknown>
    }
  ).run({ pendingExecutionId, executionMaxDuration })

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
    mocks.triggerAndWait.mockResolvedValue({
      ok: true,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      output: { success: true, pendingExecutionId: 'pending-workflow-1' },
    })
  })

  it('executes exactly the claimed row and releases capacity', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runExecution(row.id)).resolves.toEqual({
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

  it('runs the supervisor without a deadline and applies the tier duration only to the child', async () => {
    await expect(runSupervisor('pending-workflow-1', 45)).resolves.toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-1',
    })

    expect(pendingExecutionTask).toMatchObject({ maxDuration: 2_147_483_647 })
    expect(mocks.triggerAndWait).toHaveBeenCalledWith(
      { pendingExecutionId: 'pending-workflow-1' },
      { maxDuration: 45 }
    )
  })

  it('persists a hard maxDuration timeout after Trigger stops the bounded child', async () => {
    const row = processingRow()
    const timeoutError = new Error('Task exceeded its maxDuration')
    timeoutError.name = 'MAX_DURATION_EXCEEDED'
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.triggerAndWait.mockResolvedValueOnce({
      ok: false,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      error: timeoutError,
    })

    await expect(runSupervisor(row.id, 45)).rejects.toThrow(
      'Workflow execution time limit exceeded'
    )

    expect(mocks.loggingCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 45_000,
        error: { message: 'Workflow execution time limit exceeded' },
      })
    )
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({ pendingExecutionId: row.id })
    expect(mocks.loggingCompleteWithError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completePendingExecution.mock.invocationCallOrder[0]
    )
  })

  it('leaves bounded child failures for the supervisor to finalize', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeWorkflowJob.mockRejectedValueOnce(new Error('Execution infrastructure failed'))

    await expect(runExecution(row.id)).rejects.toThrow('Execution infrastructure failed')

    expect(mocks.loggingCompleteWithError).not.toHaveBeenCalled()
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })

  it('terminalizes a failed Airtable continuation admission', async () => {
    const row = processingRow({
      executionType: 'webhook',
      source: 'webhook:airtable',
      payload: { provider: 'airtable', phase: 'initial' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.triggerAndWait.mockResolvedValueOnce({
      ok: false,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      error: new Error('Continuation admission failed'),
    })

    await expect(runSupervisor(row.id)).rejects.toThrow('Continuation admission failed')

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

    await expect(runExecution(row.id)).resolves.toMatchObject({ success: true })

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
    mocks.triggerAndWait.mockResolvedValueOnce({
      ok: false,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      error: new Error('PDF parse failed'),
    })

    await expect(runSupervisor(row.id)).rejects.toThrow('PDF parse failed')
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
