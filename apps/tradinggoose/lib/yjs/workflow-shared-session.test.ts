import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const mockBootstrapYjsProvider = vi.fn()
const mockWaitForYjsSync = vi.fn()
const mockRegisterWorkflowSession = vi.fn()
const mockUnregisterWorkflowSession = vi.fn()

vi.mock('@/lib/yjs/provider', () => ({
  bootstrapYjsProvider: (...args: any[]) => mockBootstrapYjsProvider(...args),
  waitForYjsSync: (...args: any[]) => mockWaitForYjsSync(...args),
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

function createBootstrapResult(doc: Y.Doc, provider: ReturnType<typeof createMockProvider>) {
  let resolveLifecycle!: (event: unknown) => void
  const lifecycle = new Promise((resolve) => {
    resolveLifecycle = resolve
  })
  const result = {
    doc,
    provider,
    descriptor: {
      workspaceId: 'workspace-1',
      entityKind: 'workflow',
      entityId: 'workflow-1',
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: 'workflow-1',
    },
    lifecycle,
    dispose: vi.fn(() => {
      provider.disconnect()
      provider.destroy()
      doc.destroy()
    }),
    emitTerminal: (error: Error & { retryable: false }) =>
      resolveLifecycle({ type: 'terminal-failure', error }),
    emitResync: (pendingLocalEdits?: unknown) =>
      resolveLifecycle({ type: 'resync-required', pendingLocalEdits }),
  }
  return result
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
    mockWaitForYjsSync.mockReset()
    mockWaitForYjsSync.mockResolvedValue(undefined)
    mockRegisterWorkflowSession.mockReset()
    mockUnregisterWorkflowSession.mockReset()
    globalThis.__workflowYjsSessionEntries = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.__workflowYjsSessionEntries = undefined
  })

  it('does not publish a readable doc before bootstrap completes', async () => {
    const doc = new Y.Doc()
    const provider = createMockProvider()
    let finishBootstrap!: () => void
    const bootstrapReady = new Promise<void>((resolve) => {
      finishBootstrap = resolve
    })

    mockBootstrapYjsProvider.mockImplementation(async () => {
      await bootstrapReady
      return createBootstrapResult(doc, provider)
    })

    const { acquireSharedWorkflowSession, getSharedWorkflowSessionState } = await import(
      './workflow-shared-session'
    )

    const release = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    await waitForCondition(() => {
      expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
    })
    expect(getSharedWorkflowSessionState('workflow-1')).toMatchObject({
      doc: null,
      isLoading: true,
    })

    finishBootstrap()

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').doc).toBe(doc)
      expect(getSharedWorkflowSessionState('workflow-1').isLoading).toBe(false)
    })

    release()
  })

  it('reuses one workflow session and clears it on terminal revocation', async () => {
    const doc = new Y.Doc()
    const provider = createMockProvider()

    const result = createBootstrapResult(doc, provider)
    mockBootstrapYjsProvider.mockResolvedValue(result)

    const {
      acquireSharedWorkflowSession,
      acquireWritableWorkflowSessionLease,
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
    expect(mockBootstrapYjsProvider.mock.calls[0]).toEqual([
      expect.objectContaining({
        workspaceId: 'workspace-1',
        entityKind: 'workflow',
        entityId: 'workflow-1',
        yjsSessionId: 'workflow-1',
      }),
      undefined,
      'write',
      undefined,
    ])

    const writeLease = await acquireWritableWorkflowSessionLease({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    expect(mockWaitForYjsSync).toHaveBeenCalledWith(provider)
    expect(writeLease.session.workspaceId).toBe('workspace-1')
    writeLease.release()

    expect(mockRegisterWorkflowSession).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      doc,
    })

    result.emitTerminal(
      Object.assign(new Error('Authorization revoked'), { retryable: false as const })
    )
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1')).toMatchObject({
        doc: null,
        provider: null,
        error: 'Authorization revoked',
      })
    })
    expect(mockUnregisterWorkflowSession).toHaveBeenCalledWith('workflow-1', doc)
    expect(result.dispose).toHaveBeenCalledOnce()
    await expect(
      acquireWritableWorkflowSessionLease({
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      })
    ).rejects.toThrow('Authorization revoked')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mockBootstrapYjsProvider).toHaveBeenCalledOnce()
    releaseEditor()
    releaseChat()
  })

  it('retries a failed workflow rebootstrap with the retained local edits', async () => {
    const stale = createBootstrapResult(new Y.Doc(), createMockProvider())
    const fresh = createBootstrapResult(new Y.Doc(), createMockProvider())
    mockBootstrapYjsProvider
      .mockResolvedValueOnce(stale)
      .mockRejectedValueOnce(new Error('realtime unavailable'))
      .mockResolvedValueOnce(fresh)

    const { acquireSharedWorkflowSession, getSharedWorkflowSessionState } = await import(
      './workflow-shared-session'
    )
    const release = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').doc).toBe(stale.doc)
    })

    const pendingLocalEdits = { base: new Uint8Array([0]), current: new Uint8Array([1]) }
    stale.emitResync(pendingLocalEdits)
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').error).toBe('realtime unavailable')
    })
    await vi.advanceTimersByTimeAsync(1_000)
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').doc).toBe(fresh.doc)
    })

    expect(stale.dispose).toHaveBeenCalledOnce()
    expect(mockBootstrapYjsProvider.mock.calls.slice(1)).toEqual([
      [
        expect.objectContaining({ yjsSessionId: 'workflow-1' }),
        undefined,
        'write',
        pendingLocalEdits,
      ],
      [
        expect.objectContaining({ yjsSessionId: 'workflow-1' }),
        undefined,
        'write',
        pendingLocalEdits,
      ],
    ])
    release()
  })

  it('keeps the shared session alive when a new consumer reacquires during the destroy grace window', async () => {
    const doc = new Y.Doc()
    const destroyDoc = vi.spyOn(doc, 'destroy')
    const provider = createMockProvider()

    mockBootstrapYjsProvider.mockResolvedValue(createBootstrapResult(doc, provider))

    const { acquireSharedWorkflowSession, getSharedWorkflowSessionState } = await import(
      './workflow-shared-session'
    )

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

  it('tracks undo/redo for explicit workflow edit origins', async () => {
    const doc = new Y.Doc()
    const provider = createMockProvider()

    mockBootstrapYjsProvider.mockResolvedValue(createBootstrapResult(doc, provider))

    const {
      acquireSharedWorkflowSession,
      getSharedWorkflowSessionState,
      undoSharedWorkflowSession,
    } = await import('./workflow-shared-session')

    const release = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').doc).toBe(doc)
    })

    const workflowMap = doc.getMap('workflow')

    doc.transact(() => {
      workflowMap.set('blocks', { blockA: { id: 'blockA' } })
    }, YJS_ORIGINS.USER)

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').canUndo).toBe(true)
    })

    undoSharedWorkflowSession('workflow-1')

    await waitForCondition(() => {
      expect(workflowMap.get('blocks')).toBeUndefined()
      expect(getSharedWorkflowSessionState('workflow-1').canRedo).toBe(true)
    })

    doc.transact(() => {
      workflowMap.set('blocks', { blockB: { id: 'blockB' } })
    }, YJS_ORIGINS.COPILOT_REVIEW_ACCEPT)

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1').canUndo).toBe(true)
    })

    undoSharedWorkflowSession('workflow-1')

    await waitForCondition(() => {
      expect(workflowMap.get('blocks')).toBeUndefined()
    })

    release()
  })
})
