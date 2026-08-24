/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingExecutionClaim } from '@/lib/execution/pending-execution'

const mocks = vi.hoisted(() => ({
  cancelPendingWorkflowExecution: vi.fn(),
  executePendingExecutionJob: vi.fn(),
  markDocumentProcessingJobFailed: vi.fn(),
  getProcessingPendingExecution: vi.fn(),
  isTierLimitedPendingExecution: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  settlePendingExecutionOwner: vi.fn(),
  logLimit: vi.fn(),
  loggerError: vi.fn(),
  loggingCompleteWithError: vi.fn(),
  loggingStart: vi.fn(),
  cancelPendingExecutionTriggerRun: vi.fn(),
  triggerAndWait: vi.fn(),
  waitFor: vi.fn(),
  wakePendingExecution: vi.fn(),
  task: vi.fn((config) => ({ ...config, triggerAndWait: mocks.triggerAndWait })),
}))

vi.mock('@trigger.dev/sdk', () => ({
  AbortTaskRunError: class AbortTaskRunError extends Error {
    name = 'AbortTaskRunError'
  },
  task: mocks.task,
  timeout: { None: 2_147_483_647 },
  wait: { for: mocks.waitFor },
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
  cancelPendingExecutionTriggerRun: mocks.cancelPendingExecutionTriggerRun,
  getProcessingPendingExecution: mocks.getProcessingPendingExecution,
  isTierLimitedPendingExecution: mocks.isTierLimitedPendingExecution,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  settlePendingExecutionOwner: mocks.settlePendingExecutionOwner,
  PENDING_EXECUTION_CANCELLATION_ERROR: 'Workflow execution was cancelled',
  PENDING_EXECUTION_FAILURE_ERROR: 'Workflow execution stopped before it could finish',
  PENDING_EXECUTION_TASK_ID: 'pending-execution',
  PENDING_EXECUTION_TIME_LIMIT_ERROR: 'Workflow execution time limit exceeded',
  wakePendingExecution: mocks.wakePendingExecution,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(function () {
    void new.target
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
  markDocumentProcessingJobFailed: mocks.markDocumentProcessingJobFailed,
}))

vi.mock('./pending-execution-job', () => ({
  executePendingExecutionJob: mocks.executePendingExecutionJob,
}))

import {
  finalizePendingExecutionFailure,
  pendingExecutionRunTask,
  pendingExecutionTask,
} from './pending-execution-worker'

const processingRow = (overrides: Partial<PendingExecutionClaim> = {}): PendingExecutionClaim => ({
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
        billingScopeId: string
        billingScopeType: string
        executionMaxDuration?: number
      }) => Promise<unknown>
    }
  ).run({
    pendingExecutionId,
    billingScopeId: 'scope-1',
    billingScopeType: 'user',
    executionMaxDuration,
  })

describe('pending execution worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cancelPendingWorkflowExecution.mockResolvedValue({ status: 'cancelling' })
    mocks.executePendingExecutionJob.mockResolvedValue({ success: true })
    mocks.markDocumentProcessingJobFailed.mockResolvedValue(undefined)
    mocks.getProcessingPendingExecution.mockResolvedValue(null)
    mocks.isTierLimitedPendingExecution.mockImplementation(
      (row) => row.executionType !== 'document'
    )
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.settlePendingExecutionOwner.mockResolvedValue(undefined)
    mocks.logLimit.mockResolvedValue([])
    mocks.loggingCompleteWithError.mockResolvedValue(undefined)
    mocks.loggingStart.mockResolvedValue('workflow-log-1')
    mocks.triggerAndWait.mockResolvedValue({
      ok: true,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      output: { success: true, pendingExecutionId: 'pending-workflow-1' },
    })
    mocks.waitFor.mockResolvedValue(undefined)
    mocks.wakePendingExecution.mockResolvedValue({ status: 'empty' })
  })

  it('executes exactly the claimed row and releases capacity', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runExecution(row.id)).resolves.toEqual({
      success: true,
      pendingExecutionId: row.id,
    })

    expect(mocks.executePendingExecutionJob).toHaveBeenCalledWith(row, { triggerRuntime: true })
    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
  })

  it('keeps retrying a post-completion wake without repeating the completed execution', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    for (let attempt = 0; attempt < 11; attempt += 1) {
      mocks.wakePendingExecution.mockRejectedValueOnce(new Error('Trigger wake failed'))
    }
    mocks.wakePendingExecution.mockResolvedValueOnce({ status: 'empty' })

    await expect(runSupervisor(row.id)).resolves.toMatchObject({ success: true })

    expect(mocks.triggerAndWait).toHaveBeenCalledOnce()
    expect(mocks.wakePendingExecution).toHaveBeenCalledTimes(12)
    expect(mocks.waitFor).toHaveBeenCalledTimes(11)
    expect(mocks.waitFor).toHaveBeenCalledWith({ seconds: 30 })
    expect(pendingExecutionTask).toMatchObject({ retry: { maxAttempts: 10 } })
  })

  it('reuses the same child run when the supervisor retries before completion', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
    mocks.triggerAndWait
      .mockRejectedValueOnce(new Error('Trigger wait interrupted'))
      .mockResolvedValueOnce({
        ok: true,
        id: 'run-pending-execution-run',
        taskIdentifier: 'pending-execution-run',
        output: { success: true, pendingExecutionId: row.id },
      })

    await expect(runSupervisor(row.id)).rejects.toThrow('Trigger wait interrupted')
    await expect(runSupervisor(row.id)).resolves.toMatchObject({ success: true })

    expect(mocks.triggerAndWait.mock.calls[1]).toEqual(mocks.triggerAndWait.mock.calls[0])
    expect(mocks.triggerAndWait).toHaveBeenCalledWith(
      { pendingExecutionId: row.id },
      { idempotencyKey: `pending-execution-run:${row.id}` }
    )
    expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
  })

  it('wakes an owner-completed row without running its workflow again', async () => {
    const row = processingRow({
      payload: {
        ...processingRow().payload,
        ownerCompletedAt: '2026-08-23T12:00:00.000Z',
      },
    })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runSupervisor(row.id)).resolves.toMatchObject({
      success: true,
      skipped: 'owner_completed',
    })

    expect(mocks.triggerAndWait).not.toHaveBeenCalled()
    expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
  })

  it('runs the supervisor without a deadline and applies the tier duration only to the child', async () => {
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(processingRow())

    await expect(runSupervisor('pending-workflow-1', 45)).resolves.toEqual({
      success: true,
      pendingExecutionId: 'pending-workflow-1',
    })

    expect(pendingExecutionTask).toMatchObject({
      maxDuration: 2_147_483_647,
    })
    expect(mocks.triggerAndWait).toHaveBeenCalledWith(
      { pendingExecutionId: 'pending-workflow-1' },
      { idempotencyKey: 'pending-execution-run:pending-workflow-1', maxDuration: 45 }
    )
  })

  it('persists a hard maxDuration timeout after Trigger stops the bounded child', async () => {
    const row = processingRow()
    const timeoutError = new Error('Task exceeded its maxDuration')
    timeoutError.name = 'MAX_DURATION_EXCEEDED'
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
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
    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
    expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
    expect(mocks.loggingCompleteWithError.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settlePendingExecutionOwner.mock.invocationCallOrder[0]
    )
  })

  it('leaves bounded child failures for the supervisor to finalize', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executePendingExecutionJob.mockRejectedValueOnce(
      new Error('Execution infrastructure failed')
    )

    await expect(runExecution(row.id)).rejects.toThrow('Execution infrastructure failed')

    expect(mocks.loggingCompleteWithError).not.toHaveBeenCalled()
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
  })

  it('terminalizes a failed Airtable continuation admission', async () => {
    const row = processingRow({
      executionType: 'webhook',
      source: 'webhook:airtable',
      payload: { provider: 'airtable', phase: 'initial' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
    mocks.triggerAndWait.mockResolvedValueOnce({
      ok: false,
      id: 'run-pending-execution-run',
      taskIdentifier: 'pending-execution-run',
      error: new Error('Continuation admission failed'),
    })

    await expect(runSupervisor(row.id)).rejects.toThrow('Continuation admission failed')

    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
  })

  it('records document dispatch failure before releasing capacity', async () => {
    const row = processingRow({
      id: 'pending-document-1',
      executionType: 'document',
      workflowId: null,
      workspaceId: null,
      payload: { documentId: 'document-1' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
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
    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
  })

  it('settles a child and its parent after Trigger confirms cancellation', async () => {
    const parent = processingRow()
    const child = processingRow({ id: 'child-1', source: 'workflow_block' })
    mocks.listChildPendingWorkflowExecutions.mockImplementation((id) =>
      Promise.resolve(id === child.id ? [] : [child])
    )
    mocks.getProcessingPendingExecution.mockImplementation((id) =>
      Promise.resolve(id === child.id ? child : null)
    )
    mocks.cancelPendingExecutionTriggerRun.mockResolvedValueOnce({
      type: 'run',
      run: { status: 'CANCELED', durationMs: 1_000 },
    })

    await finalizePendingExecutionFailure(parent, 'Parent failed', 1_000)

    expect(mocks.cancelPendingWorkflowExecution).toHaveBeenCalledWith({
      pendingExecutionId: child.id,
      userId: child.userId,
      wake: false,
    })
    expect(mocks.loggingCompleteWithError).toHaveBeenCalledWith(
      expect.objectContaining({
        totalDurationMs: 1_000,
        error: { message: 'Workflow execution was cancelled' },
      })
    )
    expect(mocks.settlePendingExecutionOwner).toHaveBeenNthCalledWith(1, child, {
      wake: false,
    })
    expect(mocks.settlePendingExecutionOwner).toHaveBeenNthCalledWith(2, parent, {
      wake: false,
    })
  })

  it.each([
    ['a local child', { type: 'local' }],
    ['a missing Trigger run', { type: 'missing' }],
    ['a non-cancelled terminal run', { type: 'run', run: { status: 'FAILED', durationMs: 1_000 } }],
  ])('keeps parent capacity for %s', async (_scenario, cancellation) => {
    const parent = processingRow()
    const child = processingRow({ id: 'child-1', source: 'workflow_block' })
    mocks.listChildPendingWorkflowExecutions.mockImplementation((id) =>
      Promise.resolve(id === child.id ? [] : [child])
    )
    mocks.cancelPendingExecutionTriggerRun.mockResolvedValueOnce(cancellation)

    await finalizePendingExecutionFailure(parent, 'Parent failed', 1_000)

    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(parent, { wake: false })
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalledWith(child, { wake: false })
  })

  it('retains parent capacity when a child Trigger run cannot be cancelled', async () => {
    const parent = processingRow()
    const child = processingRow({ id: 'child-1', source: 'workflow_block' })
    mocks.listChildPendingWorkflowExecutions.mockImplementation((id) =>
      Promise.resolve(id === child.id ? [] : [child])
    )
    mocks.cancelPendingExecutionTriggerRun.mockRejectedValueOnce(new Error('Trigger unavailable'))

    await finalizePendingExecutionFailure(parent, 'Parent failed', 1_000)

    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(parent, { wake: false })
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalledWith(child, {
      wake: false,
    })
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to cancel Trigger run for pending execution',
      expect.objectContaining({ pendingExecutionId: child.id })
    )
  })
})
