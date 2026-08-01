import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  completeOperation: vi.fn(),
  heartbeat: vi.fn(),
  reconcile: vi.fn(),
}))

vi.mock('./workflow-execution-deadline-repository', () => ({
  heartbeatWorkflowExecutionParticipant: mocks.heartbeat,
  reconcileWorkflowExecutionDeadline: mocks.reconcile,
}))

vi.mock('./workflow-execution-lifecycle-repository', () => ({
  completeWorkflowOperation: mocks.completeOperation,
}))

import { createWorkflowExecutionRuntime } from './workflow-execution-runtime'

const lifecycle = {
  policy: {
    kind: 'bounded' as const,
    rootExecutionId: 'root-1',
    appliedTierId: 'tier-1',
    processingStartedAt: '2026-01-01T00:00:00.000Z',
    limitSeconds: '60',
    limitMicroseconds: '60000000',
  },
  attemptId: 'attempt-1',
  participantId: 'participant-1',
  startupOperationId: 'startup-1',
  isRoot: true,
}

describe('workflow execution runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mocks.completeOperation.mockResolvedValue(true)
  })

  afterEach(() => vi.useRealTimers())

  it('does not start heartbeat when initial deadline reconciliation fails', async () => {
    mocks.heartbeat.mockRejectedValueOnce(new Error('database unavailable'))
    const runtime = createWorkflowExecutionRuntime(lifecycle, vi.fn())

    await expect(runtime.start()).rejects.toThrow('database unavailable')
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.heartbeat).toHaveBeenCalledOnce()
    runtime.close()
  })

  it('rejects an already exhausted deadline before starting heartbeat', async () => {
    mocks.heartbeat.mockResolvedValueOnce({
      state: 'exhausted',
      exhaustedAt: new Date('2026-01-01T00:01:00.000Z'),
    })
    const runtime = createWorkflowExecutionRuntime(lifecycle, vi.fn())

    await expect(runtime.start()).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.heartbeat).toHaveBeenCalledOnce()
    runtime.close()
  })

  it('retries startup settlement after a transient persistence failure', async () => {
    mocks.completeOperation
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce(true)
    const runtime = createWorkflowExecutionRuntime(lifecycle, vi.fn())

    await expect(runtime.settleStartup('failed')).rejects.toThrow('database unavailable')
    await expect(runtime.settleStartup('failed')).resolves.toBeUndefined()
    await expect(runtime.settleStartup('failed')).resolves.toBeUndefined()

    expect(mocks.completeOperation).toHaveBeenCalledTimes(2)
  })

  it('aborts immediately when a late heartbeat recovers deadline exhaustion', async () => {
    mocks.heartbeat
      .mockResolvedValueOnce({ state: 'scheduled', delayMilliseconds: 60_000 })
      .mockResolvedValueOnce({
        state: 'exhausted',
        exhaustedAt: new Date('2026-01-01T00:01:00.000Z'),
      })
    const runtime = createWorkflowExecutionRuntime(lifecycle, vi.fn())

    await runtime.start()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(runtime.signal?.aborted).toBe(true)
    runtime.close()
  })
})
