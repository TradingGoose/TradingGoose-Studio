/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  claimNextLocalPendingExecutionBatch: vi.fn(),
  completePendingExecution: vi.fn(),
  executePendingExecution: vi.fn(),
  finalizePendingExecutionFailure: vi.fn(),
  getTriggerExecutionState: vi.fn(),
  isPendingExecutionOwnerCompleted: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  listProcessingPendingExecutions: vi.fn(),
  renewProcessingPendingExecutions: vi.fn(),
  releaseConnection: vi.fn(),
  reserveConnection: vi.fn(),
  reservedQuery: vi.fn(),
}))

const reservedConnection = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => mocks.reservedQuery(strings, ...values),
  { release: mocks.releaseConnection }
)

vi.mock('@tradinggoose/db', () => ({
  db: {
    $client: { reserve: mocks.reserveConnection },
  },
}))

vi.mock('@/background/pending-execution-worker', () => ({
  executePendingExecution: mocks.executePendingExecution,
  finalizePendingExecutionFailure: mocks.finalizePendingExecutionFailure,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  claimNextLocalPendingExecutionBatch: mocks.claimNextLocalPendingExecutionBatch,
  completePendingExecution: mocks.completePendingExecution,
  isPendingExecutionOwnerCompleted: mocks.isPendingExecutionOwnerCompleted,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  listProcessingPendingExecutions: mocks.listProcessingPendingExecutions,
  renewProcessingPendingExecutions: mocks.renewProcessingPendingExecutions,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

vi.mock('@/lib/trigger/settings', () => ({
  getTriggerExecutionState: mocks.getTriggerExecutionState,
}))

async function loadRuntime() {
  vi.resetModules()
  return import('./local-pending-execution-runtime')
}

describe('local pending execution runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.claimNextLocalPendingExecutionBatch.mockResolvedValue({
      nextBillingScopeId: 'scope-1',
      rows: [{ id: 'pending-1' }],
    })
    mocks.executePendingExecution.mockResolvedValue({ success: true })
    mocks.completePendingExecution.mockResolvedValue(undefined)
    mocks.finalizePendingExecutionFailure.mockResolvedValue(true)
    mocks.getTriggerExecutionState.mockResolvedValue({ mode: 'local' })
    mocks.isPendingExecutionOwnerCompleted.mockReturnValue(false)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.listProcessingPendingExecutions.mockResolvedValue([])
    mocks.renewProcessingPendingExecutions.mockResolvedValue(undefined)
    mocks.reserveConnection.mockResolvedValue(reservedConnection)
    mocks.reservedQuery
      .mockResolvedValue([{ backendPid: 1 }])
      .mockResolvedValueOnce([{ acquired: true, backendPid: 1 }])
  })

  afterEach(async () => {
    const runtime = await import('./local-pending-execution-runtime')
    await runtime.stopLocalPendingExecutionRuntime()
    vi.useRealTimers()
  })

  it('claims queued work outside the request and executes it through the shared worker', async () => {
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => {
      expect(mocks.executePendingExecution).toHaveBeenCalledWith({
        pendingExecutionId: 'pending-1',
      })
    })

    expect(mocks.reserveConnection).toHaveBeenCalledOnce()
    expect(mocks.claimNextLocalPendingExecutionBatch).toHaveBeenCalledWith({
      afterBillingScopeId: undefined,
      limit: 50,
    })
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('does not claim work when another process owns the database session lock', async () => {
    mocks.reservedQuery
      .mockReset()
      .mockResolvedValue([{ backendPid: 2 }])
      .mockResolvedValueOnce([{ acquired: false, backendPid: 2 }])
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.reserveConnection).toHaveBeenCalledOnce())

    expect(mocks.releaseConnection).toHaveBeenCalledOnce()
    expect(mocks.claimNextLocalPendingExecutionBatch).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('reacquires leadership after the reserved database session is lost', async () => {
    const nextConnectionRelease = vi.fn()
    const nextConnection = Object.assign(
      vi.fn().mockResolvedValue([{ acquired: true, backendPid: 2 }]),
      { release: nextConnectionRelease }
    )
    mocks.reservedQuery
      .mockReset()
      .mockResolvedValueOnce([{ acquired: true, backendPid: 1 }])
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue([])
    mocks.reserveConnection
      .mockResolvedValueOnce(reservedConnection)
      .mockResolvedValueOnce(nextConnection)
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.reserveConnection).toHaveBeenCalledOnce())
    await new Promise((resolve) => setTimeout(resolve, 2_100))

    expect(mocks.reserveConnection).toHaveBeenCalledTimes(2)
    expect(mocks.releaseConnection).toHaveBeenCalledOnce()
    await runtime.stopLocalPendingExecutionRuntime()
    expect(nextConnectionRelease).toHaveBeenCalledOnce()
  })

  it('does not reconcile after session loss until active work settles', async () => {
    let finishExecution: (() => void) | undefined
    mocks.executePendingExecution.mockReturnValueOnce(
      new Promise((resolve) => {
        finishExecution = () => resolve({ success: true })
      })
    )
    mocks.reservedQuery
      .mockReset()
      .mockResolvedValueOnce([{ acquired: true, backendPid: 1 }])
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValue([])
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.executePendingExecution).toHaveBeenCalledOnce())
    mocks.listProcessingPendingExecutions.mockClear()
    await new Promise((resolve) => setTimeout(resolve, 2_100))

    expect(mocks.listProcessingPendingExecutions).not.toHaveBeenCalled()
    expect(mocks.reserveConnection).toHaveBeenCalledOnce()
    finishExecution?.()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('keeps leadership until active local execution settles during stop', async () => {
    let finishExecution: (() => void) | undefined
    mocks.executePendingExecution.mockReturnValueOnce(
      new Promise((resolve) => {
        finishExecution = () => resolve({ success: true })
      })
    )
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.executePendingExecution).toHaveBeenCalledOnce())
    const stopping = runtime.stopLocalPendingExecutionRuntime()
    await Promise.resolve()
    expect(mocks.releaseConnection).not.toHaveBeenCalled()

    finishExecution?.()
    await stopping
    expect(mocks.releaseConnection).toHaveBeenCalledOnce()
  })

  it('starts every fairly claimed billing scope row in a pass', async () => {
    mocks.claimNextLocalPendingExecutionBatch.mockResolvedValueOnce({
      nextBillingScopeId: 'scope-2',
      rows: [{ id: 'pending-1' }, { id: 'pending-2' }],
    })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => {
      expect(mocks.executePendingExecution).toHaveBeenCalledWith({
        pendingExecutionId: 'pending-2',
      })
    })

    expect(mocks.claimNextLocalPendingExecutionBatch).toHaveBeenCalledOnce()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('terminalizes interrupted processing rows without replaying them', async () => {
    vi.useFakeTimers()
    const interrupted = {
      id: 'interrupted-1',
      processingStartedAt: new Date(Date.now() - 5_000),
      updatedAt: new Date(Date.now() - 30_000),
    }
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([interrupted])
    mocks.claimNextLocalPendingExecutionBatch.mockResolvedValue({
      nextBillingScopeId: undefined,
      rows: [],
    })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()
    await vi.advanceTimersByTimeAsync(10_100)

    expect(mocks.finalizePendingExecutionFailure).toHaveBeenCalledWith(
      interrupted,
      'Local workflow execution stopped before it could finish',
      expect.any(Number)
    )

    expect(mocks.executePendingExecution).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('does not terminalize a processing row with a live execution lease', async () => {
    vi.useFakeTimers()
    mocks.listProcessingPendingExecutions.mockImplementation(async () => [
      {
        id: 'active-on-another-replica',
        processingStartedAt: new Date(Date.now() - 30_000),
        updatedAt: new Date(),
      },
    ])
    mocks.claimNextLocalPendingExecutionBatch.mockResolvedValue({
      nextBillingScopeId: undefined,
      rows: [],
    })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()
    await vi.advanceTimersByTimeAsync(10_100)

    expect(mocks.listProcessingPendingExecutions).toHaveBeenCalled()
    expect(mocks.finalizePendingExecutionFailure).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('releases a completed owner only after its children are gone', async () => {
    vi.useFakeTimers()
    const completedOwner = {
      id: 'parent-1',
      payload: { ownerCompletedAt: new Date().toISOString() },
      processingStartedAt: new Date(Date.now() - 5_000),
      updatedAt: new Date(Date.now() - 30_000),
    }
    mocks.isPendingExecutionOwnerCompleted.mockReturnValue(true)
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([completedOwner])
    mocks.claimNextLocalPendingExecutionBatch.mockResolvedValue({
      nextBillingScopeId: undefined,
      rows: [],
    })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()
    await vi.advanceTimersByTimeAsync(10_100)

    expect(mocks.completePendingExecution).toHaveBeenCalledWith({
      pendingExecutionId: completedOwner.id,
    })

    expect(mocks.finalizePendingExecutionFailure).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('does not claim work outside local mode', async () => {
    mocks.getTriggerExecutionState.mockResolvedValue({ mode: 'unavailable' })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.getTriggerExecutionState).toHaveBeenCalled())

    expect(mocks.reserveConnection).not.toHaveBeenCalled()
    expect(mocks.claimNextLocalPendingExecutionBatch).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })
})
