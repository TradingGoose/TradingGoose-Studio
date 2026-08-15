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
  getAirtablePollContinuation: vi.fn(),
  markDocumentProcessingJobFailed: vi.fn(),
  getProcessingPendingExecution: vi.fn(),
  isCancellationRequested: vi.fn(),
  isMonitorExecutionPayload: vi.fn(),
  isScheduleExecutionPayload: vi.fn(),
  isTierLimitedPendingExecution: vi.fn(),
  isWebhookExecutionPayload: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  listPendingExecutionBillingScopes: vi.fn(),
  listProcessingPendingExecutions: vi.fn(),
  markPendingExecutionOwnerCompleted: vi.fn(),
  logLimit: vi.fn(),
  loggerError: vi.fn(),
  loggingCompleteWithError: vi.fn(),
  loggingSessionConstructor: vi.fn(),
  loggingStart: vi.fn(),
  runsCancel: vi.fn(),
  runsList: vi.fn(),
  scheduledTask: vi.fn((config) => config),
  task: vi.fn((config) => config),
  triggerPendingExecution: vi.fn(),
  wakePendingExecution: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  runs: { cancel: mocks.runsCancel, list: mocks.runsList },
  schedules: { task: mocks.scheduledTask },
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
  pendingExecution: {},
  workflowExecutionLogs: {
    endedAt: 'workflowExecutionLogs.endedAt',
    executionId: 'workflowExecutionLogs.executionId',
    id: 'workflowExecutionLogs.id',
    level: 'workflowExecutionLogs.level',
  },
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  completePendingExecution: mocks.completePendingExecution,
  getPendingExecutionTriggerKey: (id: string) => `pending-execution:${id}`,
  getProcessingPendingExecution: mocks.getProcessingPendingExecution,
  isPendingWorkflowExecutionCancellationRequested: mocks.isCancellationRequested,
  isTierLimitedPendingExecution: mocks.isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  listPendingExecutionBillingScopes: mocks.listPendingExecutionBillingScopes,
  listProcessingPendingExecutions: mocks.listProcessingPendingExecutions,
  markPendingExecutionOwnerCompleted: mocks.markPendingExecutionOwnerCompleted,
  PENDING_EXECUTION_TASK_ID: 'pending-execution',
  triggerPendingExecution: mocks.triggerPendingExecution,
  wakePendingExecution: mocks.wakePendingExecution,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/webhooks/utils', () => ({
  getAirtablePollContinuation: mocks.getAirtablePollContinuation,
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
  pendingExecutionRecoverySweep,
  pendingExecutionTask,
  recoverPendingExecutions,
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

const runTask = (pendingExecutionId: string) =>
  (
    pendingExecutionTask as unknown as {
      run: (payload: { pendingExecutionId: string }) => Promise<unknown>
    }
  ).run({ pendingExecutionId })

function mockRun(status: string, durationMs = 1_000) {
  return { id: `run-${status}`, status, durationMs }
}

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
    mocks.getAirtablePollContinuation.mockReturnValue(null)
    mocks.markDocumentProcessingJobFailed.mockResolvedValue(undefined)
    mocks.getProcessingPendingExecution.mockResolvedValue(null)
    mocks.isCancellationRequested.mockResolvedValue(false)
    mocks.isMonitorExecutionPayload.mockReturnValue(false)
    mocks.isScheduleExecutionPayload.mockReturnValue(false)
    mocks.isTierLimitedPendingExecution.mockImplementation(
      (row) => row.executionType !== 'document'
    )
    mocks.isWebhookExecutionPayload.mockReturnValue(false)
    mocks.isWorkflowExecutionPayload.mockReturnValue(true)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.listPendingExecutionBillingScopes.mockResolvedValue([])
    mocks.listProcessingPendingExecutions.mockResolvedValue([])
    mocks.markPendingExecutionOwnerCompleted.mockResolvedValue(undefined)
    mocks.logLimit.mockResolvedValue([])
    mocks.loggingCompleteWithError.mockResolvedValue(undefined)
    mocks.loggingStart.mockResolvedValue('workflow-log-1')
    mocks.runsCancel.mockResolvedValue(undefined)
    mocks.runsList.mockResolvedValue({ data: [], pagination: {} })
    mocks.triggerPendingExecution.mockResolvedValue(undefined)
    mocks.wakePendingExecution.mockResolvedValue(undefined)
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

  it('retains and recovers failed Airtable continuation admission', async () => {
    const row = processingRow({
      executionType: 'webhook',
      source: 'webhook:airtable',
      payload: { provider: 'airtable', phase: 'initial' },
    })
    const stagedRow = { ...row, payload: { provider: 'airtable', phase: 'staged' } }
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row).mockResolvedValueOnce(stagedRow)
    mocks.isWebhookExecutionPayload.mockReturnValue(true)
    mocks.executeWebhookJob.mockRejectedValueOnce(new Error('Continuation admission failed'))
    mocks.getAirtablePollContinuation.mockImplementation((payload) =>
      payload.phase === 'staged' ? { externalId: 'remote', cursor: 10 } : null
    )
    mocks.logLimit.mockResolvedValue([{ id: 'log-1', endedAt: new Date(), level: 'info' }])

    await expect(runTask(row.id)).rejects.toThrow('Continuation admission failed')

    expect(mocks.completePendingExecution).not.toHaveBeenCalled()

    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([stagedRow])
    mocks.runsList.mockResolvedValueOnce({ data: [mockRun('FAILED')], pagination: {} })

    await recoverPendingExecutions()

    expect(mocks.executeWebhookJob).toHaveBeenCalledTimes(2)
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: stagedRow.id,
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

  it('retains parent capacity until a processing child is gone', async () => {
    const parent = processingRow()
    const child = processingRow({ id: 'child-1', source: 'workflow_block' })
    let parentReads = 0
    mocks.listChildPendingWorkflowExecutions.mockImplementation((id) => {
      if (id === child.id) return Promise.resolve([])
      parentReads += 1
      return Promise.resolve([child])
    })
    mocks.runsList.mockResolvedValueOnce({ data: [mockRun('EXECUTING')], pagination: {} })

    await expect(
      finalizePendingExecutionFailure(parent as any, 'Parent failed', 1_000, {
        cancelTriggerRuns: true,
      })
    ).resolves.toBe(false)

    expect(parentReads).toBe(2)
    expect(mocks.cancelPendingWorkflowExecution).toHaveBeenCalledWith({
      pendingExecutionId: child.id,
      userId: child.userId,
    })
    expect(mocks.runsCancel).toHaveBeenCalledWith('run-EXECUTING')
    expect(mocks.markPendingExecutionOwnerCompleted).toHaveBeenCalledWith(parent)
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })

  it('uses a singleton Trigger queue for the minutely recovery sweep', () => {
    expect(pendingExecutionRecoverySweep).toMatchObject({
      id: 'pending-execution-recovery-sweep',
      queue: { name: 'pending-execution-recovery', concurrencyLimit: 1 },
    })
  })
})

describe('recoverPendingExecutions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completePendingExecution.mockResolvedValue(undefined)
    mocks.isCancellationRequested.mockResolvedValue(false)
    mocks.isTierLimitedPendingExecution.mockReturnValue(true)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.listPendingExecutionBillingScopes.mockResolvedValue([])
    mocks.listProcessingPendingExecutions.mockResolvedValue([])
    mocks.logLimit.mockResolvedValue([])
    mocks.loggingCompleteWithError.mockResolvedValue(undefined)
    mocks.loggingStart.mockResolvedValue('workflow-log-1')
    mocks.runsCancel.mockResolvedValue(undefined)
    mocks.runsList.mockResolvedValue({ data: [], pagination: {} })
    mocks.triggerPendingExecution.mockResolvedValue(undefined)
    mocks.wakePendingExecution.mockResolvedValue(undefined)
  })

  it('leaves an active Trigger run and capacity row untouched', async () => {
    const row = processingRow()
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({ data: [mockRun('EXECUTING')], pagination: {} })

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 0,
      reconciledCount: 1,
    })
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
    expect(mocks.listProcessingPendingExecutions).toHaveBeenCalledWith({
      afterId: undefined,
      limit: 50,
    })
  })

  it('does not inspect or wake queue rows outside Trigger mode', async () => {
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce(null)

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 0,
      reconciledCount: 0,
    })

    expect(mocks.listProcessingPendingExecutions).toHaveBeenCalledWith({
      afterId: undefined,
      limit: 50,
    })
    expect(mocks.listPendingExecutionBillingScopes).not.toHaveBeenCalled()
    expect(mocks.runsList).not.toHaveBeenCalled()
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
  })

  it.each([
    ['TIMED_OUT', 'Workflow execution time limit exceeded', true],
    ['CANCELED', 'Workflow execution was cancelled', false],
    ['EXPIRED', 'Workflow execution expired before it started', true],
    ['CRASHED', 'Workflow execution stopped before it could finish', true],
    ['FAILED', 'Workflow execution stopped before it could finish', true],
    ['SYSTEM_FAILURE', 'Workflow execution stopped before it could finish', true],
  ])('terminalizes %s before releasing capacity', async (status, message, billable) => {
    const row = processingRow()
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({ data: [mockRun(status, 2_500)], pagination: {} })

    await recoverPendingExecutions()

    expect(mocks.loggingCompleteWithError).toHaveBeenCalledWith({
      totalDurationMs: 2_500,
      error: { message },
      workspaceId: row.workspaceId,
      actorUserId: row.userId,
      billable,
    })
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({ pendingExecutionId: row.id })
  })

  it('retries only an ambiguous Trigger admission', async () => {
    const row = processingRow()
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([row])

    await recoverPendingExecutions()

    expect(mocks.triggerPendingExecution).toHaveBeenCalledWith(row)
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })

  it('paginates processing rows and billing scopes', async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      processingRow({ id: `row-${String(index).padStart(2, '0')}` })
    )
    const lastRow = processingRow({ id: 'row-50' })
    mocks.listProcessingPendingExecutions
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([lastRow])
    mocks.runsList.mockResolvedValue({ data: [mockRun('EXECUTING')], pagination: {} })
    const firstScopes = Array.from({ length: 50 }, (_, index) => ({
      billingScopeId: `scope-${String(index).padStart(2, '0')}`,
    }))
    mocks.listPendingExecutionBillingScopes
      .mockResolvedValueOnce(firstScopes)
      .mockResolvedValueOnce([{ billingScopeId: 'scope-50' }])

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 51,
      reconciledCount: 51,
    })
    expect(mocks.listProcessingPendingExecutions).toHaveBeenNthCalledWith(2, {
      afterId: 'row-49',
      limit: 50,
    })
    expect(mocks.listPendingExecutionBillingScopes).toHaveBeenNthCalledWith(2, {
      afterBillingScopeId: 'scope-49',
      limit: 50,
    })
    expect(mocks.wakePendingExecution).toHaveBeenCalledTimes(51)
  })
})
