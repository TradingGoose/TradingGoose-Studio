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
    emit: (event: string) => {
      for (const handler of listeners.get(event) ?? []) handler()
    },
  }
}

function createBootstrapResult(doc: Y.Doc, provider: ReturnType<typeof createMockProvider>) {
  return {
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
    runtime: {
      docState: 'active',
      replaySafe: true,
      reseededFromCanonical: false,
    },
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
      accessMode: 'write',
    })

    await waitForCondition(() => {
      expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
    })
    expect(getSharedWorkflowSessionState('workflow-1', 'write')).toMatchObject({
      doc: null,
      isLoading: true,
    })

    finishBootstrap()

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'write').doc).toBe(doc)
      expect(getSharedWorkflowSessionState('workflow-1', 'write').isLoading).toBe(false)
    })

    release()
  })

  it('reuses one bootstrapped workflow session across multiple acquisitions', async () => {
    const doc = new Y.Doc()
    const destroyDoc = vi.spyOn(doc, 'destroy')
    const provider = createMockProvider()

    mockBootstrapYjsProvider.mockResolvedValue(createBootstrapResult(doc, provider))

    const {
      acquireSharedWorkflowSession,
      acquireWritableWorkflowSessionLease,
      getSharedWorkflowSessionState,
    } = await import('./workflow-shared-session')

    const releaseEditor = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'write',
    })
    const releaseChat = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'write',
    })

    await waitForCondition(() => {
      expect(mockBootstrapYjsProvider).toHaveBeenCalledTimes(1)
      expect(getSharedWorkflowSessionState('workflow-1', 'write').provider).toBe(provider as any)
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

    mockBootstrapYjsProvider.mockResolvedValue(createBootstrapResult(doc, provider))

    const { acquireSharedWorkflowSession, getSharedWorkflowSessionState } = await import(
      './workflow-shared-session'
    )

    const releaseEditor = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'write',
    })

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'write').provider).toBe(provider as any)
    })

    releaseEditor()
    await vi.advanceTimersByTimeAsync(1_000)

    const releaseChat = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'write',
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

  it('isolates reader sessions from writable sessions and leases', async () => {
    const readDoc = new Y.Doc()
    const writeDoc = new Y.Doc()
    const readProvider = createMockProvider()
    const writeProvider = createMockProvider()
    mockBootstrapYjsProvider
      .mockResolvedValueOnce(createBootstrapResult(readDoc, readProvider))
      .mockResolvedValueOnce(createBootstrapResult(writeDoc, writeProvider))

    const {
      acquireSharedWorkflowSession,
      acquireWritableWorkflowSessionLease,
      getSharedWorkflowSessionState,
    } = await import('./workflow-shared-session')

    const releaseRead = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'read',
    })
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'read').doc).toBe(readDoc)
    })
    expect(mockBootstrapYjsProvider).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ entityId: 'workflow-1' }),
      undefined,
      'read'
    )
    expect(mockRegisterWorkflowSession).not.toHaveBeenCalled()

    const writeLease = await acquireWritableWorkflowSessionLease({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
    })
    expect(writeLease.session.doc).toBe(writeDoc)
    expect(getSharedWorkflowSessionState('workflow-1', 'read').doc).toBe(readDoc)
    expect(getSharedWorkflowSessionState('workflow-1', 'write').doc).toBe(writeDoc)
    expect(mockBootstrapYjsProvider).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ entityId: 'workflow-1' }),
      undefined,
      'write'
    )
    expect(mockRegisterWorkflowSession).toHaveBeenCalledTimes(1)

    writeLease.release()
    releaseRead()
  })

  it('rebootstraps a reader session from a fresh snapshot after connection loss', async () => {
    const staleDoc = new Y.Doc()
    const freshDoc = new Y.Doc()
    const staleProvider = createMockProvider()
    const freshProvider = createMockProvider()
    mockBootstrapYjsProvider
      .mockResolvedValueOnce(createBootstrapResult(staleDoc, staleProvider))
      .mockResolvedValueOnce(createBootstrapResult(freshDoc, freshProvider))

    const { acquireSharedWorkflowSession, getSharedWorkflowSessionState } = await import(
      './workflow-shared-session'
    )
    const release = acquireSharedWorkflowSession({
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      accessMode: 'read',
    })

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'read').doc).toBe(staleDoc)
    })
    staleProvider.emit('connection-close')
    expect(getSharedWorkflowSessionState('workflow-1', 'read').isLoading).toBe(true)

    await vi.advanceTimersByTimeAsync(1_000)
    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'read').doc).toBe(freshDoc)
    })
    expect(staleProvider.destroy).toHaveBeenCalledTimes(1)
    expect(mockRegisterWorkflowSession).not.toHaveBeenCalled()

    release()
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
      accessMode: 'write',
    })

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'write').doc).toBe(doc)
    })

    const workflowMap = doc.getMap('workflow')

    doc.transact(() => {
      workflowMap.set('blocks', { blockA: { id: 'blockA' } })
    }, YJS_ORIGINS.USER)

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'write').canUndo).toBe(true)
    })

    undoSharedWorkflowSession('workflow-1', 'write')

    await waitForCondition(() => {
      expect(workflowMap.get('blocks')).toBeUndefined()
      expect(getSharedWorkflowSessionState('workflow-1', 'write').canRedo).toBe(true)
    })

    doc.transact(() => {
      workflowMap.set('blocks', { blockB: { id: 'blockB' } })
    }, YJS_ORIGINS.COPILOT_REVIEW_ACCEPT)

    await waitForCondition(() => {
      expect(getSharedWorkflowSessionState('workflow-1', 'write').canUndo).toBe(true)
    })

    undoSharedWorkflowSession('workflow-1', 'write')

    await waitForCondition(() => {
      expect(workflowMap.get('blocks')).toBeUndefined()
    })

    release()
  })
})
