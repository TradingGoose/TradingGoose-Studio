/**
 * @vitest-environment node
 */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completePendingExecution: vi.fn(),
  dbSelect: vi.fn(),
  dbSelectDistinct: vi.fn(),
  dispatchQueuedDocumentProcessingJob: vi.fn(),
  executeMonitorJob: vi.fn(),
  executeScheduleJob: vi.fn(),
  executeWebhookJob: vi.fn(),
  executeWorkflowJob: vi.fn(),
  failQueuedDocumentProcessingJob: vi.fn(),
  getPendingExecutionTriggerKey: vi.fn(),
  getProcessingPendingExecution: vi.fn(),
  isMonitorExecutionPayload: vi.fn(),
  isPendingExecutionPayload: vi.fn(),
  isScheduleExecutionPayload: vi.fn(),
  isTierLimitedPendingExecution: vi.fn(),
  isWebhookExecutionPayload: vi.fn(),
  isWorkflowExecutionPayload: vi.fn(),
  logLimit: vi.fn(),
  loggerError: vi.fn(),
  loggingCompleteWithError: vi.fn(),
  loggingSessionConstructor: vi.fn(),
  loggingStart: vi.fn(),
  pendingScopesWhere: vi.fn(),
  processingRowsWhere: vi.fn(),
  runsList: vi.fn(),
  scheduledTask: vi.fn((config) => config),
  task: vi.fn((config) => config),
  triggerPendingExecution: vi.fn(),
  wakePendingExecution: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  runs: {
    list: mocks.runsList,
  },
  schedules: {
    task: mocks.scheduledTask,
  },
  task: mocks.task,
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: mocks.dbSelect,
    selectDistinct: mocks.dbSelectDistinct,
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  pendingExecution: {
    billingScopeId: 'pendingExecution.billingScopeId',
    status: 'pendingExecution.status',
  },
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
  getPendingExecutionTriggerKey: mocks.getPendingExecutionTriggerKey,
  getProcessingPendingExecution: mocks.getProcessingPendingExecution,
  isPendingExecutionPayload: mocks.isPendingExecutionPayload,
  isTierLimitedPendingExecution: mocks.isTierLimitedPendingExecution,
  PENDING_EXECUTION_TASK_ID: 'pending-execution',
  triggerPendingExecution: mocks.triggerPendingExecution,
  wakePendingExecution: mocks.wakePendingExecution,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    error: mocks.loggerError,
  })),
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

vi.mock('./knowledge-processing', () => ({
  dispatchQueuedDocumentProcessingJob: mocks.dispatchQueuedDocumentProcessingJob,
  failQueuedDocumentProcessingJob: mocks.failQueuedDocumentProcessingJob,
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

import { pendingExecutionTask, recoverPendingExecutions } from './pending-execution-worker'

const triggerKey = (pendingExecutionId: string) =>
  `pending-execution:${createHash('sha256').update(pendingExecutionId).digest('hex')}`

const processingRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'pending-workflow-1',
  billingScopeId: 'scope-1',
  billingScopeType: 'user',
  executionType: 'workflow',
  source: 'workflow_api',
  userId: 'user-1',
  workflowId: 'workflow-1',
  workspaceId: 'workspace-1',
  payload: {
    workflowId: 'workflow-1',
    userId: 'user-1',
  },
  status: 'processing',
  nextAttemptAt: new Date('2026-08-13T16:00:00.000Z'),
  processingStartedAt: new Date('2026-08-13T16:00:00.000Z'),
  createdAt: new Date('2026-08-13T15:59:00.000Z'),
  updatedAt: new Date('2026-08-13T16:00:00.000Z'),
  ...overrides,
})

const runPendingExecutionTask = (pendingExecutionId: string) =>
  (
    pendingExecutionTask as unknown as {
      run: (payload: { pendingExecutionId: string }) => Promise<unknown>
    }
  ).run({ pendingExecutionId })

function mockRun(status: string, durationMs = 1_000) {
  return { status, durationMs }
}

function expectRunLookup(pendingExecutionId: string) {
  expect(mocks.runsList).toHaveBeenCalledWith({
    tag: triggerKey(pendingExecutionId),
    taskIdentifier: 'pending-execution',
    limit: 1,
  })
}

describe('pendingExecutionTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProcessingPendingExecution.mockReset().mockResolvedValue(null)
    mocks.completePendingExecution.mockReset().mockResolvedValue(undefined)
    mocks.dispatchQueuedDocumentProcessingJob.mockReset().mockResolvedValue(undefined)
    mocks.executeMonitorJob.mockReset().mockResolvedValue({ success: true })
    mocks.executeScheduleJob.mockReset().mockResolvedValue({ success: true })
    mocks.executeWebhookJob.mockReset().mockResolvedValue({ success: true })
    mocks.executeWorkflowJob.mockReset().mockResolvedValue({ success: true })
    mocks.failQueuedDocumentProcessingJob.mockReset().mockResolvedValue(undefined)
    mocks.isMonitorExecutionPayload.mockReset().mockReturnValue(false)
    mocks.isScheduleExecutionPayload.mockReset().mockReturnValue(false)
    mocks.isWebhookExecutionPayload.mockReset().mockReturnValue(false)
    mocks.isWorkflowExecutionPayload.mockReset().mockReturnValue(true)
  })

  it('executes exactly the requested processing row and completes it once', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runPendingExecutionTask(row.id)).resolves.toEqual({
      success: true,
      pendingExecutionId: row.id,
    })

    expect(pendingExecutionTask.id).toBe('pending-execution')
    expect(mocks.getProcessingPendingExecution).toHaveBeenCalledOnce()
    expect(mocks.getProcessingPendingExecution).toHaveBeenCalledWith(row.id)
    expect(mocks.executeWorkflowJob).toHaveBeenCalledOnce()
    expect(mocks.executeWorkflowJob).toHaveBeenCalledWith({
      ...row.payload,
      executionId: row.id,
    })
    expect(mocks.completePendingExecution).toHaveBeenCalledOnce()
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
  })

  it('skips a row that is no longer processing', async () => {
    await expect(runPendingExecutionTask('missing-row')).resolves.toEqual({
      success: true,
      skipped: 'not_processing',
    })

    expect(mocks.executeWorkflowJob).not.toHaveBeenCalled()
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
  })

  it('leaves the row processing when execution throws', async () => {
    const row = processingRow()
    const error = new Error('Execution infrastructure failed')
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeWorkflowJob.mockRejectedValueOnce(error)

    await expect(runPendingExecutionTask(row.id)).rejects.toThrow(error.message)

    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Pending execution failed',
      expect.objectContaining({
        pendingExecutionId: row.id,
        error,
      })
    )
  })

  it('records terminal document dispatch failures and releases the row', async () => {
    const row = processingRow({
      id: 'pending-document-1',
      executionType: 'document',
      workflowId: null,
      workspaceId: null,
      payload: { documentId: 'document-1' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.dispatchQueuedDocumentProcessingJob.mockRejectedValueOnce(new Error('PDF parse failed'))

    await expect(runPendingExecutionTask(row.id)).resolves.toEqual({
      success: false,
      pendingExecutionId: row.id,
    })

    expect(mocks.dispatchQueuedDocumentProcessingJob).toHaveBeenCalledWith(row.payload)
    expect(mocks.failQueuedDocumentProcessingJob).toHaveBeenCalledWith(
      row.payload,
      'PDF parse failed'
    )
    expect(mocks.completePendingExecution).toHaveBeenCalledOnce()
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
  })

  it('dispatches one monitor row through the shared execution contract', async () => {
    const row = processingRow({
      id: 'pending-monitor-1',
      executionType: 'monitor',
      source: 'monitor:portfolio',
      payload: { monitorId: 'monitor-1' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.isMonitorExecutionPayload.mockReturnValueOnce(true)

    await expect(runPendingExecutionTask(row.id)).resolves.toEqual({
      success: true,
      pendingExecutionId: row.id,
    })

    expect(mocks.executeMonitorJob).toHaveBeenCalledOnce()
    expect(mocks.executeMonitorJob).toHaveBeenCalledWith({
      ...row.payload,
      executionId: row.id,
    })
    expect(mocks.completePendingExecution).toHaveBeenCalledOnce()
  })
})

describe('recoverPendingExecutions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.completePendingExecution.mockReset().mockResolvedValue(undefined)
    mocks.dbSelect.mockImplementation((selection?: unknown) => {
      if (selection === undefined) {
        return {
          from: vi.fn(() => ({
            where: mocks.processingRowsWhere,
          })),
        }
      }

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: mocks.logLimit,
          })),
        })),
      }
    })
    mocks.dbSelectDistinct.mockImplementation(() => ({
      from: vi.fn(() => ({
        where: mocks.pendingScopesWhere,
      })),
    }))
    mocks.getPendingExecutionTriggerKey.mockReset().mockImplementation(triggerKey)
    mocks.isPendingExecutionPayload
      .mockReset()
      .mockImplementation((value) => Boolean(value && typeof value === 'object'))
    mocks.isTierLimitedPendingExecution
      .mockReset()
      .mockImplementation((row) => ['workflow', 'webhook', 'schedule'].includes(row.executionType))
    mocks.logLimit.mockReset().mockResolvedValue([])
    mocks.loggingCompleteWithError.mockReset().mockResolvedValue(undefined)
    mocks.loggingStart.mockReset().mockResolvedValue('workflow-log-1')
    mocks.pendingScopesWhere.mockReset().mockResolvedValue([])
    mocks.processingRowsWhere.mockReset().mockResolvedValue([])
    mocks.runsList.mockReset()
    mocks.triggerPendingExecution.mockReset().mockResolvedValue(undefined)
    mocks.wakePendingExecution.mockReset().mockResolvedValue(undefined)
  })

  it('leaves an active Trigger run and its processing row untouched', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('EXECUTING')],
      pagination: {},
    })

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 0,
      reconciledCount: 1,
    })

    expectRunLookup(row.id)
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
    expect(mocks.loggingCompleteWithError).not.toHaveBeenCalled()
  })

  it('terminalizes a timed-out workflow before releasing its capacity row', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('TIMED_OUT', 45_001)],
      pagination: {},
    })

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 0,
      reconciledCount: 1,
    })

    expectRunLookup(row.id)
    expect(mocks.loggingSessionConstructor).toHaveBeenCalledWith(
      row.workflowId,
      row.id,
      'manual',
      row.id.slice(0, 8),
      undefined
    )
    expect(mocks.loggingStart).toHaveBeenCalledWith({
      userId: row.userId,
      workspaceId: row.workspaceId,
      workflowState: {
        blocks: {},
        edges: [],
        loops: {},
        parallels: {},
      },
      triggerData: undefined,
    })
    expect(mocks.loggingCompleteWithError).toHaveBeenCalledWith({
      totalDurationMs: 45_001,
      error: { message: 'Workflow execution time limit exceeded' },
      workspaceId: row.workspaceId,
      actorUserId: row.userId,
    })
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
    expect(mocks.loggingCompleteWithError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.completePendingExecution.mock.invocationCallOrder[0]
    )
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
  })

  it('releases a row left behind by a completed Trigger run', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('COMPLETED')],
      pagination: {},
    })

    await recoverPendingExecutions()

    expectRunLookup(row.id)
    expect(mocks.completePendingExecution).toHaveBeenCalledOnce()
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
    expect(mocks.loggingCompleteWithError).not.toHaveBeenCalled()
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
  })

  it('releases a failed run when the workflow log is already terminal', async () => {
    const row = processingRow()
    const endedAt = new Date('2026-08-13T16:01:00.000Z')
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('FAILED')],
      pagination: {},
    })
    mocks.logLimit.mockResolvedValueOnce([{ id: 'workflow-log-1', endedAt }])

    await recoverPendingExecutions()

    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
  })

  it('releases a canceled run without creating a second terminalization path', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('CANCELED', 2_500)],
      pagination: {},
    })

    await recoverPendingExecutions()

    expect(mocks.loggingCompleteWithError).not.toHaveBeenCalled()
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
  })

  it('releases a failed Trigger run without replaying workflow side effects', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({
      data: [mockRun('FAILED')],
      pagination: {},
    })
    await recoverPendingExecutions()

    expectRunLookup(row.id)
    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: row.id,
    })
    expect(mocks.triggerPendingExecution).not.toHaveBeenCalled()
  })

  it('retries an ambiguous Trigger admission without releasing its capacity row', async () => {
    const row = processingRow()
    mocks.processingRowsWhere.mockResolvedValueOnce([row])
    mocks.runsList.mockResolvedValueOnce({ data: [], pagination: {} })
    await recoverPendingExecutions()

    expectRunLookup(row.id)
    expect(mocks.triggerPendingExecution).toHaveBeenCalledWith(row)
    expect(mocks.completePendingExecution).not.toHaveBeenCalled()
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
  })

  it('wakes each scope that still has pending work without executing it inline', async () => {
    mocks.pendingScopesWhere.mockResolvedValueOnce([
      { billingScopeId: 'scope-1' },
      { billingScopeId: 'scope-2' },
    ])

    await expect(recoverPendingExecutions()).resolves.toEqual({
      pendingScopeCount: 2,
      reconciledCount: 0,
    })

    expect(mocks.wakePendingExecution).toHaveBeenCalledTimes(2)
    expect(mocks.wakePendingExecution).toHaveBeenCalledWith({ billingScopeId: 'scope-1' })
    expect(mocks.wakePendingExecution).toHaveBeenCalledWith({ billingScopeId: 'scope-2' })
    expect(mocks.executeWorkflowJob).not.toHaveBeenCalled()
  })
})
