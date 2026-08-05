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
  cancelRun: vi.fn(),
  infrastructure: vi.fn(),
  terminalAttempt: vi.fn(),
  decrypt: vi.fn(),
}))

vi.mock('@trigger.dev/sdk', () => ({
  task: (configuration: unknown) => configuration,
  runs: { cancel: mocks.cancelRun, retrieve: mocks.retrieve },
}))

vi.mock('@/lib/execution/workflow-execution-lifecycle-repository', () => ({
  cancelWorkflowExecutionAtomically: mocks.cancel,
  claimWorkflowOperationsForTermination: mocks.claim,
  getWorkflowExecutionProjection: mocks.projection,
  listOpenWorkflowExecutionAttemptsForRoot: mocks.attempts,
  recordWorkflowInfrastructureCandidate: mocks.infrastructure,
  recordWorkflowAttemptTerminalObservation: mocks.terminalAttempt,
  recordWorkflowOperationObservation: mocks.observe,
  reconcileWorkflowDeadlineTermination: mocks.arbitrate,
  scheduleWorkflowTerminationReconcile: mocks.schedule,
}))

vi.mock('@/lib/utils-server', () => ({
  decryptSecret: mocks.decrypt,
}))

import { reconcileWorkflowTermination } from './workflow-execution-termination-reconcile'

describe('reconcileWorkflowTermination', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.projection.mockResolvedValue({ actorUserId: 'user-1' })
    mocks.arbitrate.mockResolvedValue(null)
    mocks.schedule.mockResolvedValue(undefined)
    mocks.attempts.mockResolvedValue([])
    mocks.cancelRun.mockResolvedValue({ id: 'run-1' })
    mocks.decrypt.mockResolvedValue({ decrypted: 'secret-key' })
  })

  it.each([
    {
      adapterKind: 'apify_run',
      responses: [{}, { data: { status: 'ABORTED' } }],
      state: 'canceled',
    },
    {
      adapterKind: 'exa_research',
      responses: [{ status: 'completed' }],
      state: 'completed',
    },
    {
      adapterKind: 'firecrawl_crawl',
      responses: [{ status: 'accepted' }, { status: 'failed' }],
      state: 'failed',
    },
    {
      adapterKind: 'browser_use_task_with_profile_session',
      responses: [{}, { status: 'stopped' }, {}],
      state: 'canceled',
      sessionId: 'session-1',
    },
  ])('durably reconciles $adapterKind terminal state', async (testCase) => {
    mocks.claim.mockResolvedValue([
      {
        id: 'operation-remote',
        capability: 'native_cancel_status',
        adapterKind: testCase.adapterKind,
        remoteOperationId: 'remote-1',
        observation: {
          _credentialLease: 'ciphertext',
          ...(testCase.sessionId ? { sessionId: testCase.sessionId } : {}),
        },
        fencingToken: 'fence-remote',
      },
    ])
    const responses = [...testCase.responses]
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const body = responses.shift() ?? {}
        return {
          ok: true,
          status: 200,
          json: async () => body,
        }
      })
    )

    await reconcileWorkflowTermination('root-1')

    expect(mocks.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'operation-remote' }),
        fencingToken: 'fence-remote',
        state: testCase.state,
      })
    )
  })

  it.each(['credential', 'provider'])(
    'keeps durable work nonterminal on %s failure',
    async (failure) => {
      mocks.claim.mockResolvedValue([
        {
          id: 'operation-retry',
          capability: 'status_only',
          adapterKind: 'exa_research',
          remoteOperationId: 'remote-1',
          observation: { _credentialLease: 'ciphertext' },
          fencingToken: 'fence-retry',
        },
      ])
      if (failure === 'credential') mocks.decrypt.mockRejectedValue(new Error('decrypt failed'))
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('provider failed')))

      await reconcileWorkflowTermination('root-1')

      expect(mocks.observe).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({ id: 'operation-retry' }),
          observation: { adapter: 'exa_research', outcome: 'unknown' },
        })
      )
      expect(mocks.observe).toHaveBeenCalledWith(
        expect.not.objectContaining({ state: expect.anything() })
      )
    }
  )

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
      actorUserId: 'user-1',
      descendantOnly: true,
    })
    expect(mocks.observe).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: expect.objectContaining({ id: 'operation-1' }),
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
    expect(mocks.schedule).toHaveBeenCalledWith('root-1', true)
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

  it('requests cancellation for an active Trigger attempt without crossing the barrier', async () => {
    mocks.attempts.mockResolvedValue([
      { id: 'attempt-1', rootExecutionId: 'root-1', drainRunId: 'run-1' },
    ])
    mocks.retrieve.mockResolvedValue({ id: 'run-1', status: 'EXECUTING' })
    mocks.claim.mockResolvedValue([])

    await reconcileWorkflowTermination('root-1')

    expect(mocks.cancelRun).toHaveBeenCalledWith('run-1')
    expect(mocks.terminalAttempt).not.toHaveBeenCalled()
    expect(mocks.cancelRun.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.arbitrate.mock.invocationCallOrder[0]
    )
    expect(mocks.schedule).toHaveBeenCalledWith('root-1', false)
  })

  it('keeps a Trigger attempt unresolved when its cancellation request fails', async () => {
    mocks.attempts.mockResolvedValue([
      { id: 'attempt-1', rootExecutionId: 'root-1', drainRunId: 'run-1' },
    ])
    mocks.retrieve.mockResolvedValue({ id: 'run-1', status: 'EXECUTING' })
    mocks.cancelRun.mockRejectedValue(new Error('Trigger unavailable'))
    mocks.claim.mockResolvedValue([])

    await reconcileWorkflowTermination('root-1')

    expect(mocks.terminalAttempt).not.toHaveBeenCalled()
    expect(mocks.schedule).toHaveBeenCalledWith('root-1', false)
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
