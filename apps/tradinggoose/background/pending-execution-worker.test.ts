/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PendingExecutionClaim } from '@/lib/execution/pending-execution'

const mocks = vi.hoisted(() => ({
  cancelPendingWorkflowExecution: vi.fn(),
  executeBackgroundExecution: vi.fn(),
  failDocumentAttempt: vi.fn(),
  getProcessingPendingExecution: vi.fn(),
  isWorkflowPendingExecution: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  settlePendingExecutionOwner: vi.fn(),
  logLimit: vi.fn(),
  loggerError: vi.fn(),
  loggingComplete: vi.fn(),
  completeWorkflowExecution: vi.fn(),
  settleWorkflowExecutionUsage: vi.fn(),
  emit: vi.fn(),
  loggingStart: vi.fn(),
  cancelRun: vi.fn(),
  triggerAndWait: vi.fn(),
  waitFor: vi.fn(),
  wakePendingExecution: vi.fn(),
  task: vi.fn((config) => config),
  completeWorkflowCheckpointChild: vi.fn(),
  readWorkflowCheckpointChildren: vi.fn(),
  readWorkflowCheckpointSnapshot: vi.fn(),
  recoverWorkflowCheckpointSegment: vi.fn(),
  reconcileWorkflowCheckpointChildren: vi.fn(),
  settleScheduleOccurrence: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  AbortTaskRunError: class AbortTaskRunError extends Error {
    name = 'AbortTaskRunError'
  },
  task: mocks.task,
  runs: {
    list: vi.fn().mockResolvedValue({
      data: [{ id: 'supervisor', status: 'EXECUTING', isCompleted: false, durationMs: 1000 }],
    }),
    cancel: mocks.cancelRun,
  },
  tasks: { triggerAndWait: mocks.triggerAndWait },
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

vi.mock('drizzle-orm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('drizzle-orm')>()),
  eq: vi.fn((field, value) => ({ field, value })),
}))

vi.mock('@/lib/execution/pending-execution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/execution/pending-execution')>()),
  getProcessingPendingExecution: mocks.getProcessingPendingExecution,
  isWorkflowPendingExecution: mocks.isWorkflowPendingExecution,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  settlePendingExecutionOwner: mocks.settlePendingExecutionOwner,
  wakePendingExecution: mocks.wakePendingExecution,
}))

vi.mock('@/lib/logs/events', () => ({ emitWorkflowExecutionCompleted: mocks.emit }))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: mocks.loggerError }),
}))

vi.mock('@/lib/logs/execution/logging-session', () => ({
  LoggingSession: vi.fn().mockImplementation(function () {
    void new.target
    return {
      complete: mocks.loggingComplete,
      start: mocks.loggingStart,
    }
  }),
}))
vi.mock('@/lib/logs/execution/logger', () => ({
  executionLogger: {
    completeWorkflowExecution: mocks.completeWorkflowExecution,
    settleWorkflowExecutionUsage: mocks.settleWorkflowExecutionUsage,
  },
}))
vi.mock('@/lib/telemetry/tracer', () => ({ trackPlatformEvent: vi.fn() }))

vi.mock('@/lib/workflows/queued-execution-cancellation', () => ({
  cancelPendingWorkflowExecution: mocks.cancelPendingWorkflowExecution,
}))
vi.mock('@/lib/workflows/human-in-the-loop/service', () => ({
  completeWorkflowCheckpointChild: mocks.completeWorkflowCheckpointChild,
  readWorkflowCheckpointChildren: mocks.readWorkflowCheckpointChildren,
  readWorkflowCheckpointSnapshot: mocks.readWorkflowCheckpointSnapshot,
  recoverWorkflowCheckpointSegment: mocks.recoverWorkflowCheckpointSegment,
  reconcileWorkflowCheckpointChildren: mocks.reconcileWorkflowCheckpointChildren,
}))

vi.mock('@/lib/knowledge/documents/claim', () => ({
  failDocumentAttempt: mocks.failDocumentAttempt,
}))

vi.mock('./execution-job', () => ({
  executeBackgroundExecution: mocks.executeBackgroundExecution,
}))
vi.mock('./schedule-execution', () => ({
  isScheduleExecutionPayload: () => true,
  settleScheduleOccurrence: mocks.settleScheduleOccurrence,
}))

import {
  cancelPendingExecutionDescendants,
  executePendingExecutionRun,
  finalizePendingExecutionFailure,
  terminalizeWorkflowExecution,
} from './pending-execution-worker'
import { pendingExecutionTask } from './tasks/pending-execution'

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

const terminalLog = (failed = false) => ({
  id: 'retained-log',
  level: failed ? 'error' : 'info',
  startedAt: new Date('2026-08-13T16:00:00.000Z'),
  endedAt: new Date('2026-08-13T16:00:01.000Z'),
  totalDurationMs: 1000,
  executionData: { finalOutput: { result: 42 } },
})

function queuedChildScenario(resumed = false) {
  const parent = processingRow()
  const childExecutionId = 'child-1'
  const child = processingRow({
    id: resumed ? `${childExecutionId}:resume:1` : childExecutionId,
    source: resumed ? 'human_in_the_loop' : 'workflow_block',
    payload: resumed ? { resumeExecutionId: childExecutionId } : {},
  })
  mocks.listChildPendingWorkflowExecutions.mockImplementation(async ({ executionId: id }) =>
    id === parent.id && !resumed ? [child] : []
  )
  mocks.readWorkflowCheckpointChildren.mockImplementation(async (id) =>
    id === parent.id ? [{ id: childExecutionId, userId: child.userId }] : []
  )
  mocks.cancelPendingWorkflowExecution.mockResolvedValue({
    status: 'cancelling',
    pendingExecutionId: child.id,
  })
  mocks.getProcessingPendingExecution.mockImplementation(async (id) =>
    id === child.id ? child : null
  )
  return { parent, child, childExecutionId }
}

const runExecution = (
  pendingExecutionId: string,
  executionType: PendingExecutionClaim['executionType'] = 'workflow'
) => executePendingExecutionRun({ pendingExecutionId, executionType })

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
    mocks.executeBackgroundExecution.mockResolvedValue({ success: true })
    mocks.failDocumentAttempt.mockResolvedValue(true)
    mocks.getProcessingPendingExecution.mockResolvedValue(null)
    mocks.isWorkflowPendingExecution.mockImplementation(
      (row) => row.executionType !== 'document' && row.source !== 'monitor:indicator:calculation'
    )
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.settlePendingExecutionOwner.mockResolvedValue(undefined)
    mocks.logLimit.mockResolvedValue([])
    mocks.loggingComplete.mockResolvedValue(undefined)
    mocks.settleWorkflowExecutionUsage.mockResolvedValue(undefined)
    mocks.emit.mockResolvedValue(undefined)
    mocks.loggingStart.mockResolvedValue('workflow-log-1')
    mocks.triggerAndWait.mockResolvedValue({
      ok: true,
      id: 'run-background-execution',
      taskIdentifier: 'workflow-execution',
      output: { success: true, pendingExecutionId: 'pending-workflow-1' },
    })
    mocks.waitFor.mockResolvedValue(undefined)
    mocks.wakePendingExecution.mockResolvedValue({ status: 'empty' })
    mocks.readWorkflowCheckpointChildren.mockResolvedValue([])
    mocks.readWorkflowCheckpointSnapshot.mockResolvedValue(null)
    mocks.recoverWorkflowCheckpointSegment.mockResolvedValue(false)
    mocks.reconcileWorkflowCheckpointChildren.mockResolvedValue(undefined)
  })

  it('executes exactly the claimed row and releases capacity', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)

    await expect(runExecution(row.id)).resolves.toEqual({
      success: true,
      pendingExecutionId: row.id,
    })

    expect(mocks.executeBackgroundExecution).toHaveBeenCalledWith(row, undefined, undefined)
    expect(mocks.reconcileWorkflowCheckpointChildren).toHaveBeenCalledWith(row.id)
    expect(mocks.reconcileWorkflowCheckpointChildren.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.settlePendingExecutionOwner.mock.invocationCallOrder[0]
    )
    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
  })

  it('retains an aborted workflow for the cancellation hook to retire and wake its scope', async () => {
    const row = processingRow()
    const controller = new AbortController()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeBackgroundExecution.mockImplementationOnce(async () => controller.abort())
    await executePendingExecutionRun(
      { pendingExecutionId: row.id, executionType: 'workflow' },
      controller.signal
    )
    expect(mocks.reconcileWorkflowCheckpointChildren).toHaveBeenCalledWith(row.id)
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
  })

  it.each(['document', 'monitor'] as const)(
    'passes cancellation to %s without loading workflow checkpoint state',
    async (executionType) => {
      const row = processingRow({ executionType, source: 'monitor:indicator:calculation' })
      mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
      const signal = new AbortController().signal
      await executePendingExecutionRun({ pendingExecutionId: row.id, executionType }, signal)
      expect(mocks.executeBackgroundExecution).toHaveBeenCalledWith(row, signal, undefined)
      expect(mocks.reconcileWorkflowCheckpointChildren).not.toHaveBeenCalled()
      expect(mocks.recoverWorkflowCheckpointSegment).not.toHaveBeenCalled()
      expect(mocks.logLimit).not.toHaveBeenCalled()
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledTimes(
        executionType === 'document' ? 0 : 1
      )
    }
  )

  it.each(['workflow', 'webhook', 'schedule', 'monitor'] as const)(
    'retains the %s owner when resumed workflow checkpoint reconciliation fails',
    async (executionType) => {
      const row = processingRow({
        id: 'original:resume:1',
        executionType,
        source: executionType === 'monitor' ? 'monitor:portfolio' : 'human_in_the_loop',
        payload: { resumeExecutionId: 'original' },
      })
      mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
      mocks.reconcileWorkflowCheckpointChildren.mockRejectedValueOnce(new Error('Wake failed'))
      await expect(runExecution(row.id, executionType)).rejects.toThrow('Wake failed')
      expect(mocks.reconcileWorkflowCheckpointChildren).toHaveBeenCalledWith('original')
      expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
    }
  )

  it('rejects a queued row belonging to another task before execution or settlement', async () => {
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(
      processingRow({ executionType: 'document' })
    )
    await expect(runExecution('pending-workflow-1')).rejects.toThrow('Execution task type differs')
    expect(mocks.executeBackgroundExecution).not.toHaveBeenCalled()
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
  })

  it('keeps retrying a post-completion wake without repeating the completed execution', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    for (let attempt = 0; attempt < 11; attempt += 1) {
      mocks.wakePendingExecution.mockRejectedValueOnce(new Error('Trigger wake failed'))
    }
    mocks.wakePendingExecution.mockResolvedValueOnce({ status: 'empty' })

    await expect(runSupervisor(row.id)).rejects.toThrow('Trigger wake failed')
    await expect(runSupervisor(row.id)).resolves.toMatchObject({ success: true })

    expect(mocks.triggerAndWait).toHaveBeenCalledOnce()
    expect(mocks.wakePendingExecution).toHaveBeenCalledTimes(12)
    expect(mocks.waitFor).toHaveBeenCalledTimes(10)
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
        id: 'run-background-execution',
        taskIdentifier: 'workflow-execution',
        output: { success: true, pendingExecutionId: row.id },
      })

    await expect(runSupervisor(row.id)).rejects.toThrow('Trigger wait interrupted')
    await expect(runSupervisor(row.id)).resolves.toMatchObject({ success: true })

    expect(mocks.triggerAndWait.mock.calls[1]).toEqual(mocks.triggerAndWait.mock.calls[0])
    expect(mocks.triggerAndWait).toHaveBeenCalledWith(
      'workflow-execution',
      {
        pendingExecutionId: row.id,
        billingScopeId: row.billingScopeId,
        billingScopeType: row.billingScopeType,
      },
      { idempotencyKey: `workflow-execution:${row.id}`, maxDuration: 2_147_483_647 }
    )
    expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
  })

  it('honors a cancellation recorded before the workload starts', async () => {
    const row = processingRow({ payload: { cancelRequestedAt: new Date().toISOString() } })
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    await expect(runExecution(row.id)).rejects.toThrow('Workflow execution was cancelled')
    expect(mocks.executeBackgroundExecution).not.toHaveBeenCalled()
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
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
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    await expect(runExecution(row.id)).resolves.toMatchObject({ skipped: 'owner_completed' })
    expect(mocks.executeBackgroundExecution).not.toHaveBeenCalled()
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
      'workflow-execution',
      {
        pendingExecutionId: 'pending-workflow-1',
        billingScopeId: 'scope-1',
        billingScopeType: 'user',
      },
      { idempotencyKey: 'workflow-execution:pending-workflow-1', maxDuration: 45 }
    )
  })

  it.each(['workflow', 'monitor'] as const)(
    'settles a %s maxDuration timeout',
    async (executionType) => {
      const row = processingRow({
        executionType,
        source: executionType === 'monitor' ? 'monitor:indicator:calculation' : 'workflow_api',
      })
      const timeoutError = new Error('Task exceeded its maxDuration')
      timeoutError.name = 'MAX_DURATION_EXCEEDED'
      mocks.getProcessingPendingExecution.mockResolvedValue(row)
      mocks.triggerAndWait.mockResolvedValueOnce({
        ok: false,
        id: 'run-background-execution',
        taskIdentifier: 'workflow-execution',
        error: timeoutError,
      })

      await expect(runSupervisor(row.id, 45)).rejects.toThrow(
        'Workflow execution time limit exceeded'
      )

      if (executionType === 'workflow') {
        expect(mocks.loggingComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            totalDurationMs: 45_000,
            success: false,
            failureReason: 'Workflow execution time limit exceeded',
          })
        )
        expect(mocks.loggingComplete.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.settlePendingExecutionOwner.mock.invocationCallOrder[0]
        )
      } else {
        expect(mocks.recoverWorkflowCheckpointSegment).not.toHaveBeenCalled()
        expect(mocks.loggingStart).not.toHaveBeenCalled()
        expect(mocks.loggingComplete).not.toHaveBeenCalled()
      }
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
      expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
    }
  )

  it('leaves bounded child failures for the supervisor to finalize', async () => {
    const row = processingRow()
    mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
    mocks.executeBackgroundExecution.mockRejectedValueOnce(
      new Error('Execution infrastructure failed')
    )

    await expect(runExecution(row.id)).rejects.toThrow('Execution infrastructure failed')

    expect(mocks.loggingComplete).not.toHaveBeenCalled()
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
      id: 'run-background-execution',
      taskIdentifier: 'workflow-execution',
      error: new Error('Continuation admission failed'),
    })

    await expect(runSupervisor(row.id)).rejects.toThrow('Continuation admission failed')

    expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
  })

  it.each([5, 900, 2147483647])(
    'applies %s seconds to a single document child',
    async (maxDuration) => {
      const row = processingRow({ executionType: 'document', source: 'document_processing' })
      mocks.getProcessingPendingExecution.mockResolvedValueOnce(row)
      await runSupervisor(row.id, maxDuration)
      expect(mocks.triggerAndWait).toHaveBeenCalledExactlyOnceWith(
        'knowledge-process-document',
        {
          pendingExecutionId: row.id,
          billingScopeId: row.billingScopeId,
          billingScopeType: row.billingScopeType,
        },
        { idempotencyKey: `knowledge-process-document:${row.id}`, maxDuration }
      )
    }
  )

  it('wakes capacity only after document failure cleanup commits', async () => {
    const row = processingRow({
      id: 'pending-document-1',
      executionType: 'document',
      workflowId: null,
      workspaceId: null,
      payload: { documentId: 'document-1' },
    })
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
    mocks.triggerAndWait.mockResolvedValue({
      ok: false,
      error: new Error('Execution failed'),
    })
    mocks.failDocumentAttempt.mockRejectedValueOnce(new Error('Retirement failed'))
    await expect(runSupervisor(row.id)).rejects.toThrow('Retirement failed')
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()

    let commit!: () => void
    mocks.failDocumentAttempt.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        commit = () => resolve(true)
      })
    )
    const settled = expect(runSupervisor(row.id)).rejects.toThrow('Execution failed')
    await vi.waitFor(() => expect(mocks.failDocumentAttempt).toHaveBeenCalledTimes(2))
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()
    commit()
    await settled
    expect(mocks.wakePendingExecution).toHaveBeenCalledOnce()
    expect(mocks.failDocumentAttempt).toHaveBeenCalledWith({ id: row.id }, 'Execution failed')
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
    expect(mocks.recoverWorkflowCheckpointSegment).not.toHaveBeenCalled()
    expect(mocks.loggingStart).not.toHaveBeenCalled()
    expect(mocks.listChildPendingWorkflowExecutions).not.toHaveBeenCalled()
  })

  it.each(['workflow', 'webhook', 'monitor'] as const)(
    'preserves a newer %s checkpoint when old-segment maintenance fails',
    async (executionType) => {
      const row = processingRow({
        executionType,
        id: 'original:resume:1',
        payload: { resumeExecutionId: 'original', checkpointRevision: 1 },
      })
      mocks.recoverWorkflowCheckpointSegment.mockResolvedValueOnce(true)
      expect(await finalizePendingExecutionFailure(row, 'Wake failed', 500)).toBe(true)
      expect(mocks.recoverWorkflowCheckpointSegment).toHaveBeenCalledWith({
        executionId: 'original',
        userId: 'user-1',
        workflowId: 'workflow-1',
        checkpointRevision: 1,
      })
      expect(mocks.loggingComplete).not.toHaveBeenCalled()
      expect(mocks.cancelPendingWorkflowExecution).not.toHaveBeenCalled()
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
    }
  )

  it('retries schedule advancement after checkpoint recovery before releasing the occurrence', async () => {
    const row = processingRow({
      executionType: 'schedule',
      payload: {
        scheduleId: 'schedule-1',
        workflowId: 'workflow-1',
        executionId: 'pending-workflow-1',
        blockId: 'trigger-1',
        cronExpression: '*/2 * * * *',
        utcOffset: 0,
        now: '2026-09-16T12:00:00Z',
      },
    })
    mocks.getProcessingPendingExecution.mockResolvedValue(row)
    mocks.triggerAndWait.mockImplementation(async () => {
      try {
        return { ok: true, output: await runExecution(row.id, row.executionType) }
      } catch (error) {
        return { ok: false, error }
      }
    })
    mocks.recoverWorkflowCheckpointSegment.mockResolvedValue(true)
    mocks.settleScheduleOccurrence
      .mockRejectedValueOnce(new Error('Schedule write failed'))
      .mockRejectedValueOnce(new Error('Schedule still unavailable'))
      .mockResolvedValueOnce(undefined)

    await expect(runSupervisor(row.id)).rejects.toThrow('Schedule still unavailable')
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
    expect(mocks.wakePendingExecution).not.toHaveBeenCalled()

    await expect(runSupervisor(row.id)).resolves.toMatchObject({ success: true })
    expect(mocks.settleScheduleOccurrence).toHaveBeenCalledTimes(3)
    expect(mocks.settleScheduleOccurrence).toHaveBeenLastCalledWith(row.payload, 'success')
    expect(mocks.settleScheduleOccurrence.mock.invocationCallOrder[2]).toBeLessThan(
      mocks.settlePendingExecutionOwner.mock.invocationCallOrder[0]
    )
    expect(mocks.executeBackgroundExecution).not.toHaveBeenCalled()
    expect(mocks.loggingComplete).not.toHaveBeenCalled()
    expect(mocks.cancelPendingWorkflowExecution).not.toHaveBeenCalled()
  })

  it('retains the owner for supervisor retry while checkpoint reconciliation remains unavailable', async () => {
    mocks.recoverWorkflowCheckpointSegment.mockRejectedValueOnce(new Error('Database unavailable'))
    await expect(
      finalizePendingExecutionFailure(processingRow(), 'Wake failed', 500)
    ).rejects.toThrow('Database unavailable')
    expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
    expect(mocks.loggingComplete).not.toHaveBeenCalled()
  })

  it.each([
    ['Permission revoked', 500],
    ['Workflow execution was cancelled', 500],
    ['Workflow execution was cancelled', 0],
  ] as const)(
    'restores active duration and functional prior work once after multiple pauses: %s (%sms current attempt)',
    async (message, durationMs) => {
      const row = processingRow({
        id: 'original:resume:2',
        source: 'human_in_the_loop',
        payload: { resumeExecutionId: 'original' },
      })
      const { LoggingSession } = await vi.importActual<
        typeof import('@/lib/logs/execution/logging-session')
      >('@/lib/logs/execution/logging-session')
      mocks.loggingComplete.mockImplementationOnce((params) =>
        new LoggingSession('workflow-1', 'original', 'manual', undefined, 'original-log').complete(
          params
        )
      )
      mocks.logLimit.mockResolvedValueOnce([{ id: 'original-log', endedAt: null }])
      mocks.readWorkflowCheckpointSnapshot.mockResolvedValueOnce({
        triggerType: 'manual',
        executor: {
          context: {
            blockLogs: [
              {
                id: 'pending-execution-worker.test.ts:saved-occurrence:1',
                blockId: 'before-pause',
                blockType: 'agent',
                startedAt: '2026-09-01T00:00:00Z',
                endedAt: '2026-09-01T00:00:01Z',
                durationMs: 1000,
                success: true,
                output: {
                  model: 'test-model',
                  content: 'completed paid work',
                },
              },
              {
                id: 'pending-execution-worker.test.ts:saved-occurrence:2',
                blockId: 'between-pauses',
                blockType: 'function',
                startedAt: '2026-09-01T06:00:00Z',
                endedAt: '2026-09-01T06:00:04Z',
                durationMs: 4000,
                success: true,
                output: {},
              },
            ],
            metadata: { duration: 5000 },
          },
        },
      })
      await finalizePendingExecutionFailure(row, message, durationMs)
      expect(mocks.loggingStart).not.toHaveBeenCalled()
      expect(mocks.loggingComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          totalDurationMs: 5000 + durationMs,
          billable: true,
          traceSpans: [
            expect.objectContaining({
              startTime: '2026-09-01T00:00:00.000Z',
              endTime: '2026-09-01T06:00:04.000Z',
              duration: 21_604_000,
              children: [
                expect.objectContaining({
                  blockId: 'before-pause',
                  output: expect.objectContaining({ content: 'completed paid work' }),
                }),
                expect.objectContaining({ blockId: 'between-pauses', duration: 4000 }),
              ],
            }),
          ],
        })
      )
      expect(mocks.completeWorkflowCheckpointChild).toHaveBeenCalledWith(
        expect.objectContaining({
          childExecutionId: 'original',
          input: expect.objectContaining({ success: false, error: message }),
        })
      )
      expect(mocks.listChildPendingWorkflowExecutions).toHaveBeenCalledWith({
        executionId: 'original',
      })
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledWith(row, { wake: false })
      expect(mocks.completeWorkflowExecution).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          executionId: 'original',
          workflowLogId: 'original-log',
          totalDurationMs: 5000 + durationMs,
          traceSpans: [
            expect.objectContaining({
              children: expect.arrayContaining([
                expect.objectContaining({
                  output: expect.objectContaining({ content: 'completed paid work' }),
                }),
              ]),
            }),
          ],
        })
      )
      mocks.logLimit.mockResolvedValueOnce([terminalLog()])
      await terminalizeWorkflowExecution(row, durationMs, message)
      expect(mocks.loggingComplete).toHaveBeenCalledOnce()
      expect(mocks.completeWorkflowExecution).toHaveBeenCalledOnce()
    }
  )

  it('records pre-start cancellation without billing through the same log finalizer', async () => {
    const row = processingRow({
      payload: {
        triggerType: 'api-endpoint',
        executionTarget: 'live',
        workflowData: { blocks: {}, edges: [], loops: {}, parallels: {} },
        metadata: { parentExecutionId: 'parent', source: 'workflow_block' },
      },
    })
    await terminalizeWorkflowExecution(row, 0, 'Workflow execution was cancelled', false)
    expect(mocks.loggingStart).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: row.userId,
        workspaceId: row.workspaceId,
        workflowState: row.payload.workflowData,
        triggerData: { queuedExecution: row.payload.metadata },
      })
    )
    expect(mocks.loggingComplete).toHaveBeenCalledWith(
      expect.objectContaining({
        billable: false,
        success: false,
        failureReason: 'Workflow execution was cancelled',
      })
    )
    expect(mocks.completeWorkflowCheckpointChild).toHaveBeenCalledWith(
      expect.objectContaining({ childExecutionId: row.id })
    )
  })

  it.each(['completed', 'failed'])(
    'retries accounting and parent completion of a %s execution without republishing webhooks',
    async (status) => {
      const row = processingRow({
        id: 'original:resume:1',
        payload: { resumeExecutionId: 'original' },
      })
      mocks.logLimit.mockResolvedValue([terminalLog(status === 'failed')])
      const result = { success: status === 'completed', output: { result: 42 } }
      mocks.settleWorkflowExecutionUsage.mockRejectedValueOnce(new Error('Ledger unavailable'))
      await expect(finalizePendingExecutionFailure(row, 'Late failure', 50)).rejects.toThrow(
        'Ledger unavailable'
      )
      expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
      expect(mocks.emit).not.toHaveBeenCalled()
      expect(mocks.completeWorkflowCheckpointChild).not.toHaveBeenCalled()

      mocks.completeWorkflowCheckpointChild.mockRejectedValueOnce(
        new Error('Checkpoint unavailable')
      )
      await expect(finalizePendingExecutionFailure(row, 'Late failure', 50)).rejects.toThrow(
        'Checkpoint unavailable'
      )
      expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
      expect(mocks.emit).not.toHaveBeenCalled()

      await finalizePendingExecutionFailure(row, 'Late failure', 50)
      expect(mocks.settleWorkflowExecutionUsage).toHaveBeenCalledTimes(3)
      expect(mocks.settleWorkflowExecutionUsage).toHaveBeenLastCalledWith('original')
      expect(mocks.emit).not.toHaveBeenCalled()
      expect(mocks.loggingComplete).not.toHaveBeenCalled()
      expect(mocks.executeBackgroundExecution).not.toHaveBeenCalled()
      expect(mocks.completeWorkflowCheckpointChild).toHaveBeenCalledTimes(2)
      expect(mocks.completeWorkflowCheckpointChild).toHaveBeenLastCalledWith({
        childExecutionId: 'original',
        input: expect.objectContaining(result),
      })
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledExactlyOnceWith(row, {
        wake: false,
      })
    }
  )

  it('cancels stored paused children that have no pending queue row', async () => {
    const row = processingRow()
    mocks.readWorkflowCheckpointChildren.mockImplementation(async (id) =>
      id === row.id ? [{ id: 'paused-child', userId: 'user-1', workspaceId: 'workspace-1' }] : []
    )
    await finalizePendingExecutionFailure(row, 'Parent failed', 50)
    expect(mocks.cancelPendingWorkflowExecution).toHaveBeenCalledWith({
      pendingExecutionId: 'paused-child',
      userId: 'user-1',
      wake: false,
      descendantCancellation: true,
    })
  })

  it.each(['queued', 'paused', 'resumed'] as const)(
    'freezes a %s child before cancelling descendants that can notify it',
    async (kind) => {
      const parent = processingRow()
      const child = processingRow({ id: 'child', source: 'workflow_block' })
      const resumedChild = processingRow({
        id: 'child:resume:1',
        source: 'human_in_the_loop',
        payload: { resumeExecutionId: child.id },
      })
      const grandchild = { id: 'grandchild', userId: 'user-1' }
      const cancelled: string[] = []
      mocks.listChildPendingWorkflowExecutions.mockImplementation(async ({ executionId: id }) =>
        kind === 'queued' && id === parent.id ? [child] : []
      )
      mocks.readWorkflowCheckpointChildren.mockImplementation(async (id) => {
        if (id === parent.id) return kind !== 'queued' ? [child] : []
        if (id === child.id) return [grandchild]
        return [{ id: parent.id, userId: 'user-1' }]
      })
      mocks.cancelPendingWorkflowExecution.mockImplementation(
        async ({ pendingExecutionId, descendantCancellation }) => {
          expect(descendantCancellation).toBe(true)
          if (pendingExecutionId === grandchild.id) expect(cancelled).toContain(child.id)
          cancelled.push(pendingExecutionId)
          return {
            status: 'cancelling',
            pendingExecutionId:
              kind === 'resumed' && pendingExecutionId === child.id ? resumedChild.id : undefined,
          }
        }
      )
      await finalizePendingExecutionFailure(parent, 'Parent failed', 50)
      expect(cancelled).toEqual([child.id, grandchild.id])
    }
  )

  describe.each([false, true])('child cancellation (resumed: %s)', (resumed) => {
    it('retains the child owner until its executing task settles', async () => {
      const { parent, child, childExecutionId } = queuedChildScenario(resumed)
      let finish!: () => void
      const held = new Promise<void>((resolve) => {
        finish = resolve
      })
      mocks.executeBackgroundExecution.mockReturnValueOnce(held)
      const executing = runExecution(child.id)
      try {
        await vi.waitFor(() => expect(mocks.executeBackgroundExecution).toHaveBeenCalledOnce())
        await cancelPendingExecutionDescendants(parent.id)
        expect(mocks.cancelPendingWorkflowExecution).toHaveBeenCalledExactlyOnceWith({
          pendingExecutionId: childExecutionId,
          userId: child.userId,
          wake: false,
          descendantCancellation: true,
        })
        expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
        expect(mocks.cancelRun).not.toHaveBeenCalled()
        expect(mocks.completeWorkflowCheckpointChild).not.toHaveBeenCalled()
        expect(mocks.loggingComplete).not.toHaveBeenCalled()
      } finally {
        finish()
        await executing
      }
      expect(mocks.reconcileWorkflowCheckpointChildren).toHaveBeenCalledExactlyOnceWith(
        childExecutionId
      )
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledExactlyOnceWith(child, {
        wake: false,
      })
    })

    it('preserves a finished child outcome until its owner settles', async () => {
      const { parent, child, childExecutionId } = queuedChildScenario(resumed)
      mocks.cancelPendingWorkflowExecution.mockResolvedValue({
        status: 'finished',
        pendingExecutionId: child.id,
      })
      mocks.logLimit.mockResolvedValue([terminalLog()])
      const result = { success: true, output: { result: 42 } }

      await cancelPendingExecutionDescendants(parent.id)
      expect(mocks.settlePendingExecutionOwner).not.toHaveBeenCalled()
      expect(mocks.completeWorkflowCheckpointChild).not.toHaveBeenCalled()
      await finalizePendingExecutionFailure(child, 'Workflow execution was cancelled', 1_000)
      expect(mocks.settleWorkflowExecutionUsage).toHaveBeenCalledExactlyOnceWith(childExecutionId)
      expect(mocks.loggingComplete).not.toHaveBeenCalled()
      expect(mocks.completeWorkflowCheckpointChild).toHaveBeenCalledExactlyOnceWith({
        childExecutionId,
        input: expect.objectContaining(result),
      })
      expect(mocks.settlePendingExecutionOwner).toHaveBeenCalledExactlyOnceWith(child, {
        wake: false,
      })
    })
  })
})
