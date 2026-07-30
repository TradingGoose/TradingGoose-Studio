import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claim: vi.fn(),
  projection: vi.fn(),
  observe: vi.fn(),
  arbitrate: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  attempts: vi.fn(),
  retrieve: vi.fn(),
  refreshAttempt: vi.fn(),
  infrastructure: vi.fn(),
  terminalAttempt: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: (configuration: unknown) => configuration,
  runs: { retrieve: mocks.retrieve },
}))

vi.mock('@/lib/execution/workflow-execution-lifecycle-repository', () => ({
  claimWorkflowOperationsForTermination: mocks.claim,
  getWorkflowExecutionProjection: mocks.projection,
  listOpenWorkflowExecutionAttemptsForRoot: mocks.attempts,
  recordWorkflowInfrastructureCandidate: mocks.infrastructure,
  recordWorkflowAttemptTerminalObservation: mocks.terminalAttempt,
  recordWorkflowOperationObservation: mocks.observe,
  reconcileWorkflowDeadlineTermination: mocks.arbitrate,
  scheduleWorkflowTerminationReconcile: mocks.schedule,
}))

vi.mock('@/lib/execution/workflow-execution-deadline-repository', () => ({
  refreshWorkflowExecutionAttemptParticipant: mocks.refreshAttempt,
}))

vi.mock('@/lib/workflows/queued-execution-cancellation', () => ({
  cancelPendingWorkflowExecution: mocks.cancel,
}))

import { reconcileWorkflowTermination } from './workflow-execution-termination-reconcile'

describe('reconcileWorkflowTermination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.projection.mockResolvedValue({ actorUserId: 'user-1' })
    mocks.arbitrate.mockResolvedValue(null)
    mocks.schedule.mockResolvedValue(undefined)
    mocks.attempts.mockResolvedValue([])
  })

  it('requests native child cancellation and crosses the barrier only after terminal status', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'operation-1',
        capability: 'native_cancel_status',
        adapterKind: 'workflow',
        remoteOperationId: 'child-1',
        fencingToken: 'fence-1',
      },
    ])
    mocks.cancel.mockResolvedValue({ status: 'finished' })

    await reconcileWorkflowTermination('root-1')

    expect(mocks.cancel).toHaveBeenCalledWith({
      pendingExecutionId: 'child-1',
      userId: 'user-1',
      descendantOnly: true,
    })
    expect(mocks.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'operation-1',
        fencingToken: 'fence-1',
        state: 'canceled',
      })
    )
  })

  it('keeps unknown operations nonterminal and durably schedules another observation', async () => {
    mocks.claim.mockResolvedValue([
      {
        id: 'operation-2',
        capability: 'uncancelable',
        adapterKind: 'agent',
        remoteOperationId: null,
        fencingToken: 'fence-2',
      },
    ])

    await reconcileWorkflowTermination('root-1')

    expect(mocks.observe).toHaveBeenCalledWith(
      expect.not.objectContaining({ state: expect.anything() })
    )
    expect(mocks.schedule).toHaveBeenCalledWith('root-1')
  })

  it('observes the claimed Trigger attempt before terminal arbitration', async () => {
    const finishedAt = new Date('2026-01-01T00:00:30.000Z')
    mocks.attempts.mockResolvedValue([
      { id: 'attempt-1', rootExecutionId: 'root-1', drainRunId: 'run-1' },
    ])
    mocks.retrieve.mockResolvedValue({
      id: 'run-1',
      status: 'TIMED_OUT',
      finishedAt,
    })
    mocks.claim.mockResolvedValue([])

    await reconcileWorkflowTermination('root-1')

    expect(mocks.infrastructure).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      rootExecutionId: 'root-1',
      failedAt: finishedAt,
      diagnostics: { triggerRunId: 'run-1', status: 'TIMED_OUT' },
    })
    expect(mocks.infrastructure.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.arbitrate.mock.invocationCallOrder[0]
    )
  })

  it.each(['COMPLETED', 'CANCELED'] as const)(
    'closes a Trigger %s attempt without manufacturing a PM18 cause',
    async (status) => {
      const finishedAt = new Date('2026-01-01T00:00:30.000Z')
      mocks.attempts.mockResolvedValue([
        { id: 'attempt-1', rootExecutionId: 'root-1', drainRunId: 'run-1' },
      ])
      mocks.retrieve.mockResolvedValue({ id: 'run-1', status, finishedAt })
      mocks.claim.mockResolvedValue([])

      await reconcileWorkflowTermination('root-1')

      expect(mocks.terminalAttempt).toHaveBeenCalledWith({
        attemptId: 'attempt-1',
        rootExecutionId: 'root-1',
        state: status === 'COMPLETED' ? 'completed' : 'canceled',
        finishedAt,
      })
      expect(mocks.infrastructure).not.toHaveBeenCalled()
    }
  )
})
