import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockBootstrapYjsProvider = vi.fn()
const mockRegisterWorkflowSession = vi.fn()
const mockUnregisterWorkflowSession = vi.fn()

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: any[]) => mockBootstrapYjsProvider(...args),
}))

vi.mock('@/lib/yjs/workflow-session-registry', () => ({
  registerWorkflowSession: (...args: any[]) => mockRegisterWorkflowSession(...args),
  unregisterWorkflowSession: (...args: any[]) => mockUnregisterWorkflowSession(...args),
}))

function createMockProvider() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>()

  return {
    awareness: {
      getLocalState: vi.fn(() => ({})),
      setLocalState: vi.fn(),
    },
    connect: vi.fn(),
    destroy: vi.fn(),
    disconnect: vi.fn(),
    off: vi.fn((event: string, handler: (...args: any[]) => void) => {
      listeners.get(event)?.delete(handler)
    }),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const handlers = listeners.get(event) ?? new Set()
      handlers.add(handler)
      listeners.set(event, handlers)
    }),
  }
}

async function waitForCondition(assertion: () => void, timeoutMs = 1000) {
  const start = Date.now()

  while (true) {
    try {
      assertion()
      return
    } catch (error) {
      if (Date.now() - start >= timeoutMs) {
        throw error
      }
      if (vi.isFakeTimers()) {
        await vi.advanceTimersByTimeAsync(10)
      } else {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
  }
}

describe('workflow shared session lifecycle', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    mockBootstrapYjsProvider.mockReset()
    mockRegisterWorkflowSession.mockReset()
    mockUnregisterWorkflowSession.mockReset()
    delete globalThis.__workflowYjsSessionEntries
  })

  afterEach(() => {
    vi.useRealTimers()
    delete globalThis.__workflowYjsSessionEntries
  })

  it('reuses one bootstrapped workflow session across multiple acquisitions', async () => {
    const doc = new Y.Doc()
    const destroyDoc = vi.spyOn(doc, 'destroy')
    const provider = createMockProvider()

    mockBootstrapYjsProvider.mockResolvedValue({
      doc,
      provider,
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        draftSessionId: null,
        reviewSessionId: null,
        reviewModel: null,
        yjsSessionId: 'workflow-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })

    const {
      acquireSharedWorkflowSession,
      getSharedWorkflowSessionState,
    } = await import('./workflow-shared-session')

    const releaseEditor = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    const releaseChat = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    await waitForCondition(() => {
      expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
      expect(getSharedWorkflowSessionState('workflow-1').provider).toBe(provider as any)
    })

    expect(mockRegisterWorkflowSession).toHaveBeenCalledTimes(1)

    releaseEditor()
    expect(provider.disconnect).not.toHaveBeenCalled()
    expect(provider.destroy).not.toHaveBeenCalled()
    expect(destroyDoc).not.toHaveBeenCalled()

    releaseChat()
    expect(mockUnregisterWorkflowSession).not.toHaveBeenCalled()
    expect(provider.disconnect).not.toHaveBeenCalled()
    expect(provider.destroy).not.toHaveBeenCalled()
    expect(destroyDoc).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(2_500)

    expect(mockUnregisterWorkflowSession).toHaveBeenCalledTimes(1)
    expect(provider.disconnect).toHaveBeenCalledTimes(1)
    expect(provider.destroy).toHaveBeenCalledTimes(1)
    expect(destroyDoc).toHaveBeenCalledTimes(1)
  })

  it('keeps the shared session alive when a new consumer reacquires during the destroy grace window', async () => {
    const doc = new Y.Doc()
    const destroyDoc = vi.spyOn(doc, 'destroy')
    const provider = createMockProvider()

    mockBootstrapYjsProvider.mockResolvedValue({
      doc,
      provider,
      descriptor: {
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        draftSessionId: null,
        reviewSessionId: null,
        reviewModel: null,
        yjsSessionId: 'workflow-1',
      },
      runtime: {
        docState: 'active',
        replaySafe: true,
        reseededFromCanonical: false,
      },
    })

    const {
      acquireSharedWorkflowSession,
      getSharedWorkflowSessionState,
    } = await import('./workflow-shared-session')

    const releaseEditor = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').provider).toBe(provider as any)
    })

    releaseEditor()
    await vi.advanceTimersByTimeAsync(1_000)

    const releaseChat = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    await vi.advanceTimersByTimeAsync(2_000)

    expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
    expect(mockUnregisterWorkflowSession).not.toHaveBeenCalled()
    expect(provider.disconnect).not.toHaveBeenCalled()
    expect(provider.destroy).not.toHaveBeenCalled()
    expect(destroyDoc).not.toHaveBeenCalled()

    releaseChat()
    await vi.advanceTimersByTimeAsync(2_500)

    expect(mockUnregisterWorkflowSession).toHaveBeenCalledTimes(1)
    expect(provider.disconnect).toHaveBeenCalledTimes(1)
    expect(provider.destroy).toHaveBeenCalledTimes(1)
    expect(destroyDoc).toHaveBeenCalledTimes(1)
  })
})
