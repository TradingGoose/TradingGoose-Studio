/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  claimNextPendingExecution: vi.fn(),
  completePendingExecution: vi.fn(),
  executePendingExecution: vi.fn(),
  finalizePendingExecutionFailure: vi.fn(),
  getTriggerExecutionState: vi.fn(),
  isPendingExecutionOwnerCompleted: vi.fn(),
  listChildPendingWorkflowExecutions: vi.fn(),
  listPendingExecutionBillingScopes: vi.fn(),
  listProcessingPendingExecutions: vi.fn(),
  releaseLock: vi.fn(),
  renewLock: vi.fn(),
}))

vi.mock('@/background/pending-execution-worker', () => ({
  executePendingExecution: mocks.executePendingExecution,
  finalizePendingExecutionFailure: mocks.finalizePendingExecutionFailure,
}))

vi.mock('@/lib/execution/pending-execution', () => ({
  claimNextPendingExecution: mocks.claimNextPendingExecution,
  completePendingExecution: mocks.completePendingExecution,
  isPendingExecutionOwnerCompleted: mocks.isPendingExecutionOwnerCompleted,
  listChildPendingWorkflowExecutions: mocks.listChildPendingWorkflowExecutions,
  listPendingExecutionBillingScopes: mocks.listPendingExecutionBillingScopes,
  listProcessingPendingExecutions: mocks.listProcessingPendingExecutions,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({ error: vi.fn() }),
}))

vi.mock('@/lib/redis', () => ({
  acquireLock: mocks.acquireLock,
  releaseLock: mocks.releaseLock,
  renewLock: mocks.renewLock,
}))

vi.mock('@/lib/trigger/settings', () => ({
  getTriggerExecutionState: mocks.getTriggerExecutionState,
}))

async function loadRuntime() {
  vi.resetModules()
  const runtimeGlobal = globalThis as Record<string, unknown>
  runtimeGlobal.__TRADINGGOOSE_LOCAL_PENDING_EXECUTION__ = undefined
  return import('./local-pending-execution-runtime')
}

describe('local pending execution runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.acquireLock.mockResolvedValue(true)
    mocks.claimNextPendingExecution
      .mockResolvedValueOnce({
        status: 'claimed',
        row: { id: 'pending-1' },
      })
      .mockResolvedValue({ status: 'empty' })
    mocks.executePendingExecution.mockResolvedValue({ success: true })
    mocks.completePendingExecution.mockResolvedValue(undefined)
    mocks.finalizePendingExecutionFailure.mockResolvedValue(true)
    mocks.getTriggerExecutionState.mockResolvedValue({ mode: 'local' })
    mocks.isPendingExecutionOwnerCompleted.mockReturnValue(false)
    mocks.listChildPendingWorkflowExecutions.mockResolvedValue([])
    mocks.listPendingExecutionBillingScopes.mockResolvedValue([{ billingScopeId: 'scope-1' }])
    mocks.listProcessingPendingExecutions.mockResolvedValue([])
    mocks.releaseLock.mockResolvedValue(true)
    mocks.renewLock.mockResolvedValue(true)
  })

  afterEach(() => {
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

    expect(mocks.acquireLock).toHaveBeenCalled()
    expect(mocks.claimNextPendingExecution).toHaveBeenCalledWith('scope-1')
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('terminalizes interrupted processing rows without replaying them', async () => {
    const interrupted = {
      id: 'interrupted-1',
      processingStartedAt: new Date(Date.now() - 5_000),
    }
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([interrupted])
    mocks.listPendingExecutionBillingScopes.mockResolvedValue([])
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => {
      expect(mocks.finalizePendingExecutionFailure).toHaveBeenCalledWith(
        interrupted,
        'Local workflow execution stopped before it could finish',
        expect.any(Number)
      )
    })

    expect(mocks.executePendingExecution).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('releases a completed owner only after its children are gone', async () => {
    const completedOwner = {
      id: 'parent-1',
      payload: { ownerCompletedAt: new Date().toISOString() },
      processingStartedAt: new Date(Date.now() - 5_000),
    }
    mocks.isPendingExecutionOwnerCompleted.mockReturnValue(true)
    mocks.listProcessingPendingExecutions.mockResolvedValueOnce([completedOwner])
    mocks.listPendingExecutionBillingScopes.mockResolvedValue([])
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => {
      expect(mocks.completePendingExecution).toHaveBeenCalledWith({
        pendingExecutionId: completedOwner.id,
      })
    })

    expect(mocks.finalizePendingExecutionFailure).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })

  it('does not claim work outside local mode', async () => {
    mocks.getTriggerExecutionState.mockResolvedValue({ mode: 'unavailable' })
    const runtime = await loadRuntime()
    runtime.startLocalPendingExecutionRuntime()

    await vi.waitFor(() => expect(mocks.getTriggerExecutionState).toHaveBeenCalled())

    expect(mocks.acquireLock).not.toHaveBeenCalled()
    expect(mocks.claimNextPendingExecution).not.toHaveBeenCalled()
    await runtime.stopLocalPendingExecutionRuntime()
  })
})
