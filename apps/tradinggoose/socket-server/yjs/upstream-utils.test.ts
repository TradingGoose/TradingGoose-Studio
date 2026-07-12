import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import * as syncProtocol from '@y/protocols/sync'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { YJS_CLOSE_CODE_DOCUMENT_REJECTED } from '@/lib/copilot/review-sessions/types'
import {
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { createDefaultDashboardLayoutProjection } from '@/widgets/layout-document'
import {
  abortYjsSessionDeletion,
  beginYjsSessionDeletion,
  cleanupAllDocuments,
  commitYjsSessionDeletion,
  discardDocument,
  discardDocumentIfCurrent,
  discardDocumentIfIdle,
  drainAllDocuments,
  flushDocumentPersistence,
  getDocument,
  isYjsSessionAdmissionBlocked,
  peekDocument,
  reconcileWorkspaceConnections,
  runDocumentMutation,
  setupWSConnection,
} from './upstream-utils'

const accessMocks = vi.hoisted(() => ({ verifyReviewTargetAccess: vi.fn() }))

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: accessMocks.verifyReviewTargetAccess,
}))

class TestSocket extends EventEmitter {
  readyState = 1
  binaryType = 'arraybuffer'
  send = vi.fn((_message, _options, callback?: (error?: Error) => void) => callback?.())
  ping = vi.fn()
  close = vi.fn()
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createSyncUpdateMessage(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, 0)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

function createFieldsUpdate(doc: Y.Doc, key: string, value: unknown): Uint8Array {
  const client = new Y.Doc()
  Y.applyUpdate(client, Y.encodeStateAsUpdate(doc))
  const stateVector = Y.encodeStateVector(client)
  client.getMap('fields').set(key, value)
  const update = Y.encodeStateAsUpdate(client, stateVector)
  client.destroy()
  return update
}

function createDashboardDocument(docId: string): Y.Doc {
  const source = new Y.Doc()
  seedDashboardLayoutSession(
    source,
    { layout: createDefaultDashboardLayoutProjection().layout },
    YJS_ORIGINS.SYSTEM
  )
  const state = Y.encodeStateAsUpdate(source)
  source.destroy()
  return getDocument(docId, true, state).doc
}

function changeTopology(doc: Y.Doc, id: string): void {
  getDashboardLayoutMap(doc).set('topology', {
    ...readDashboardLayoutTopology(doc),
    id,
  })
}

afterEach(() => {
  vi.useRealTimers()
  cleanupAllDocuments()
})

beforeEach(() => {
  accessMocks.verifyReviewTargetAccess.mockResolvedValue({ hasAccess: true })
})

describe('dashboard document persistence queue', () => {
  it('reports one atomic creator for a shared document id', () => {
    const first = getDocument('layout-bootstrap-race')
    const second = getDocument('layout-bootstrap-race')

    expect(first.created).toBe(true)
    expect(second).toEqual({ doc: first.doc, created: false })
  })

  it('does not discard a replacement document through a stale reference', async () => {
    const stale = getDocument('layout-replaced').doc
    discardDocumentIfIdle(stale)
    const replacement = getDocument('layout-replaced').doc
    const mutation = vi.fn()

    await discardDocumentIfCurrent(stale)
    await expect(runDocumentMutation(stale, mutation)).rejects.toThrow('draining')

    expect(mutation).not.toHaveBeenCalled()
    expect(peekDocument('layout-replaced')).toBe(replacement)
  })

  it('serializes explicit flushes and preserves a newer generation during an in-flight save', async () => {
    const doc = createDashboardDocument('layout-serialized')
    const firstWrite = deferred()
    const savedTopologyIds: string[] = []
    let callCount = 0
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      callCount += 1
      savedTopologyIds.push(readDashboardLayoutTopology(target).id)
      if (callCount === 1) await firstWrite.promise
    })

    changeTopology(doc, 'first-generation')
    const firstFlush = flushDocumentPersistence(doc, persist)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))

    changeTopology(doc, 'second-generation')
    const secondFlush = flushDocumentPersistence(doc, persist)
    discardDocumentIfIdle(doc)
    expect(peekDocument('layout-serialized')).toBe(doc)

    firstWrite.resolve()
    await Promise.all([firstFlush, secondFlush])

    expect(persist).toHaveBeenCalledTimes(2)
    expect(savedTopologyIds).toEqual(['first-generation', 'second-generation'])
    discardDocumentIfIdle(doc)
    expect(peekDocument('layout-serialized')).toBeNull()
  })

  it('retries failed dirty state and completes requested idle cleanup', async () => {
    vi.useFakeTimers()
    const doc = createDashboardDocument('layout-retry')
    let attempts = 0
    const persist = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('database offline')
    })

    changeTopology(doc, 'retry-generation')
    await expect(flushDocumentPersistence(doc, persist)).rejects.toThrow('database offline')
    discardDocumentIfIdle(doc)
    expect(peekDocument('layout-retry')).toBe(doc)

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    expect(peekDocument('layout-retry')).toBeNull()
  })
})

describe('realtime shutdown', () => {
  it('persists an already-queued writer update before closing its socket', async () => {
    const descriptor = buildSavedEntityDescriptor(
      'watchlist',
      'watchlist-queued-drain',
      'workspace-1'
    )
    const socket = new TestSocket()
    const gate = deferred()
    const persistenceStarted = deferred()
    const persistence = deferred()
    const persisted = vi.fn(async (_docId: string, _doc: Y.Doc) => {
      persistenceStarted.resolve()
      await persistence.promise
    })
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'watchlist-queued-drain',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
      onDocumentIdle: persisted,
      onDocumentUpdate: persisted,
      onDocumentUpdateDebounceMs: 60_000,
    })
    const doc = peekDocument('watchlist-queued-drain')!
    const blocker = runDocumentMutation(doc, () => gate.promise)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'received', true)))
    expect(doc.getMap('fields').has('received')).toBe(false)

    const draining = drainAllDocuments()
    gate.resolve()
    await blocker
    await persistenceStarted.promise

    expect(socket.close).not.toHaveBeenCalled()
    expect(peekDocument('watchlist-queued-drain')).toBe(doc)
    expect(doc.getMap('fields').get('received')).toBe(true)

    persistence.resolve()
    await draining

    expect(persisted).toHaveBeenCalledWith('watchlist-queued-drain', doc)
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(peekDocument('watchlist-queued-drain')).toBeNull()
  })

  it('keeps a failed drain fenced while allowing a later drain retry', async () => {
    const sockets = [new TestSocket(), new TestSocket()]
    const persist = [vi.fn(), vi.fn().mockRejectedValueOnce(new Error('database offline'))]
    for (const [index, socket] of sockets.entries()) {
      const docId = `watchlist-drain-${index}`
      setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
        docId,
        userId: 'user-1',
        accessMode: 'write',
        descriptor: buildSavedEntityDescriptor('watchlist', docId, 'workspace-1'),
        onDocumentIdle: persist[index],
        onDocumentUpdate: persist[index],
        onDocumentUpdateDebounceMs: 60_000,
      })
      peekDocument(docId)!.getMap('fields').set('pending', true)
    }

    await expect(drainAllDocuments()).rejects.toThrow('database offline')

    expect(persist[0]).toHaveBeenCalledTimes(1)
    expect(persist[1]).toHaveBeenCalledTimes(1)
    expect(sockets.every((socket) => socket.close.mock.calls.length === 0)).toBe(true)
    expect(peekDocument('watchlist-drain-0')).not.toBeNull()
    expect(peekDocument('watchlist-drain-1')).not.toBeNull()

    await expect(
      runDocumentMutation(peekDocument('watchlist-drain-0')!, () => undefined)
    ).rejects.toThrow('draining')
    expect(isYjsSessionAdmissionBlocked('watchlist-drain-0')).toBe(true)
    expect(() => getDocument('new-during-drain')).toThrow('not accepting connections')
    await drainAllDocuments()

    expect(sockets.every((socket) => socket.close.mock.calls.length === 1)).toBe(true)
    expect(peekDocument('watchlist-drain-0')).toBeNull()
    expect(peekDocument('watchlist-drain-1')).toBeNull()
  })

  it('keeps a terminal persistence failure latched across drain attempts', async () => {
    const error = Object.assign(new Error('invalid canonical state'), {
      retryable: false as const,
    })
    let rejectPersistence!: (error: Error) => void
    const persistence = new Promise<void>((_resolve, reject) => {
      rejectPersistence = reject
    })
    const socket = new TestSocket()
    const persist = vi.fn(() => persistence)
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'watchlist-terminal-drain',
      userId: 'user-1',
      accessMode: 'write',
      descriptor: buildSavedEntityDescriptor(
        'watchlist',
        'watchlist-terminal-drain',
        'workspace-1'
      ),
      onDocumentIdle: persist,
      onDocumentUpdate: persist,
    })
    peekDocument('watchlist-terminal-drain')!.getMap('fields').set('invalid', true)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())

    const draining = drainAllDocuments()
    rejectPersistence(error)
    await expect(draining).rejects.toBe(error)
    expect(socket.close).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_DOCUMENT_REJECTED,
      'Canonical document rejected'
    )
    expect(peekDocument('watchlist-terminal-drain')).toBeNull()
    await expect(drainAllDocuments()).rejects.toBe(error)
  })
})

describe('document mutation queue', () => {
  it('serializes WebSocket writes behind an import and recovers after import failure', async () => {
    const descriptor = buildSavedEntityDescriptor('watchlist', 'watchlist-1', 'workspace-1')
    const source = new Y.Doc()
    source.getMap('fields').set('initial', true)
    const socket = new TestSocket()
    let database: Record<string, unknown> = {}
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      database = target.getMap('fields').toJSON()
    })
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'watchlist-1',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
      bootstrapState: Y.encodeStateAsUpdate(source),
      onDocumentUpdate: persist,
    })
    source.destroy()
    const doc = peekDocument('watchlist-1')!

    const importGate = deferred()
    const imported = runDocumentMutation(doc, async () => {
      const liveState = Y.encodeStateVector(doc)
      const staged = new Y.Doc()
      Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc))
      staged.getMap('fields').set('imported', true)
      await importGate.promise
      database = staged.getMap('fields').toJSON()
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged, liveState), YJS_ORIGINS.SYSTEM)
      staged.destroy()
    })
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'client', true)))
    await new Promise((resolve) => setImmediate(resolve))
    expect(doc.getMap('fields').has('client')).toBe(false)

    importGate.resolve()
    await imported
    await vi.waitFor(() => expect(doc.getMap('fields').get('client')).toBe(true))
    await vi.waitFor(() =>
      expect(database).toEqual({ initial: true, imported: true, client: true })
    )

    const failedImportGate = deferred()
    const failedImport = runDocumentMutation(doc, async () => {
      await failedImportGate.promise
      throw new Error('import failed')
    })
    socket.emit(
      'message',
      createSyncUpdateMessage(createFieldsUpdate(doc, 'clientAfterFailure', true))
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(doc.getMap('fields').has('clientAfterFailure')).toBe(false)

    failedImportGate.resolve()
    await expect(failedImport).rejects.toThrow('import failed')
    await vi.waitFor(() => expect(doc.getMap('fields').get('clientAfterFailure')).toBe(true))
    await vi.waitFor(() =>
      expect(database).toEqual({
        initial: true,
        imported: true,
        client: true,
        clientAfterFailure: true,
      })
    )
    expect(persist).toHaveBeenCalledTimes(2)
    socket.emit('close')
  })

  it('persists dirty watchlist state after a pending mutation fails during disconnect cleanup', async () => {
    const descriptor = buildSavedEntityDescriptor('watchlist', 'watchlist-cleanup', 'workspace-1')
    const socket = new TestSocket()
    const persistedValue = vi.fn()
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      persistedValue(target.getMap('fields').get('dirty'))
    })
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'watchlist-cleanup',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
      onDocumentIdle: persist,
      onDocumentUpdate: persist,
      onDocumentUpdateDebounceMs: 60_000,
    })
    const doc = peekDocument('watchlist-cleanup')!
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'dirty', true)))
    await vi.waitFor(() => expect(doc.getMap('fields').get('dirty')).toBe(true))
    expect(persist).not.toHaveBeenCalled()

    const gate = deferred()
    const failedMutation = runDocumentMutation(doc, async () => {
      await gate.promise
      throw new Error('mutation failed')
    })
    socket.emit('close')
    gate.resolve()

    await expect(failedMutation).rejects.toThrow('mutation failed')
    await vi.waitFor(() => expect(persistedValue).toHaveBeenCalledWith(true))
    await vi.waitFor(() => expect(peekDocument('watchlist-cleanup')).toBeNull())
  })
})

describe('orderly document discard', () => {
  it('rejects new mutations and waits for active mutation and persistence queues', async () => {
    const descriptor = buildSavedEntityDescriptor('watchlist', 'discard-watchlist', 'workspace-1')
    const socket = new TestSocket()
    const mutationGate = deferred()
    const persistenceGate = deferred()
    const persist = vi.fn(async () => persistenceGate.promise)
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'discard-watchlist',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
      onDocumentUpdate: persist,
    })
    const doc = peekDocument('discard-watchlist')!
    const mutation = runDocumentMutation(doc, async () => {
      doc.getMap('fields').set('dirty', true)
      await mutationGate.promise
    })
    await vi.waitFor(() => expect(persist).toHaveBeenCalled())

    const discarding = discardDocument('discard-watchlist')
    await expect(runDocumentMutation(doc, () => undefined)).rejects.toThrow('draining')
    expect(peekDocument('discard-watchlist')).toBe(doc)

    mutationGate.resolve()
    await mutation
    await Promise.resolve()
    expect(peekDocument('discard-watchlist')).toBe(doc)

    persistenceGate.resolve()
    await discarding
    expect(peekDocument('discard-watchlist')).toBeNull()
  })

  it('fences exact sessions until deletion abort or commit', async () => {
    vi.useFakeTimers()
    const descriptor = buildSavedEntityDescriptor('watchlist', 'leased-watchlist', 'workspace-1')
    const socket = new TestSocket()
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'leased-watchlist',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
    })

    const mutationGate = deferred()
    const mutation = runDocumentMutation(
      peekDocument('leased-watchlist')!,
      () => mutationGate.promise
    )
    const abortedLease = 'lease-abort'
    const firstBegin = beginYjsSessionDeletion(abortedLease, ['leased-watchlist'])
    let duplicateReady = false
    const duplicateBegin = beginYjsSessionDeletion(abortedLease, ['leased-watchlist']).then(() => {
      duplicateReady = true
    })
    await Promise.resolve()
    expect(duplicateReady).toBe(false)
    await expect(beginYjsSessionDeletion(abortedLease, ['different-session'])).rejects.toThrow(
      'not accepting connections'
    )
    mutationGate.resolve()
    await mutation
    await Promise.all([firstBegin, duplicateBegin])
    expect(socket.close).toHaveBeenCalledOnce()
    expect(isYjsSessionAdmissionBlocked('leased-watchlist')).toBe(true)
    expect(() =>
      setupWSConnection(new TestSocket() as unknown as WebSocket, {} as IncomingMessage, {
        docId: 'leased-watchlist',
        userId: 'user-1',
        accessMode: 'write',
        descriptor,
      })
    ).toThrow('not accepting connections')

    await vi.advanceTimersByTimeAsync(31_000)
    expect(isYjsSessionAdmissionBlocked('leased-watchlist')).toBe(true)
    abortYjsSessionDeletion(abortedLease)
    abortYjsSessionDeletion(abortedLease)
    expect(isYjsSessionAdmissionBlocked('leased-watchlist')).toBe(false)

    const committedLease = 'lease-commit'
    await beginYjsSessionDeletion(committedLease, ['deleted-watchlist'])
    commitYjsSessionDeletion(committedLease)
    commitYjsSessionDeletion(committedLease)
    abortYjsSessionDeletion(committedLease)
    expect(isYjsSessionAdmissionBlocked('deleted-watchlist')).toBe(true)
    expect(() => getDocument('deleted-watchlist')).toThrow('not accepting connections')
  })
})

describe('workspace connection authorization', () => {
  const descriptor = buildSavedEntityDescriptor('skill', 'skill-1', 'workspace-1')

  function connect() {
    const socket = new TestSocket()
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'skill-1',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
    })
    return socket
  }

  it('closes a socket immediately when a workspace permission mutation revokes access', async () => {
    const socket = connect()
    accessMocks.verifyReviewTargetAccess.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(reconcileWorkspaceConnections('workspace-1', new Set(['user-1']))).rejects.toThrow(
      'database unavailable'
    )
    expect(socket.close).not.toHaveBeenCalled()
    accessMocks.verifyReviewTargetAccess.mockResolvedValueOnce({ hasAccess: false })

    await reconcileWorkspaceConnections('workspace-1', new Set(['user-1']))

    expect(accessMocks.verifyReviewTargetAccess).toHaveBeenCalledWith('user-1', descriptor, 'write')
    expect(socket.close).toHaveBeenCalled()
    socket.emit('close')
  })

  it('periodically closes a writer whose permission was downgraded', async () => {
    vi.useFakeTimers()
    const socket = connect()
    accessMocks.verifyReviewTargetAccess.mockResolvedValueOnce({ hasAccess: false })

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled())
    socket.emit('close')
  })

  it('drops a queued writer update when access is revoked before execution', async () => {
    const socket = connect()
    const doc = peekDocument('skill-1')!
    const gate = deferred()
    const blocker = runDocumentMutation(doc, () => gate.promise)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'forbidden', true)))
    accessMocks.verifyReviewTargetAccess.mockResolvedValueOnce({ hasAccess: false })

    await reconcileWorkspaceConnections('workspace-1', new Set(['user-1']))
    gate.resolve()
    await blocker
    await new Promise((resolve) => setImmediate(resolve))

    expect(doc.getMap('fields').has('forbidden')).toBe(false)
    expect(socket.close).toHaveBeenCalled()
    socket.emit('close')
  })
})
