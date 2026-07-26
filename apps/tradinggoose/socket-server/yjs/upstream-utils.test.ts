import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import {
  buildDashboardWidgetDescriptor,
  buildSavedEntityDescriptor,
} from '@/lib/copilot/review-sessions/identity'
import {
  type ReviewTargetDescriptor,
  YJS_CLOSE_CODE_DOCUMENT_REJECTED,
} from '@/lib/copilot/review-sessions/types'
import {
  getDashboardWidgetMap,
  readDashboardWidgetDocument,
  seedDashboardWidgetSession,
} from '@/lib/yjs/dashboard-layout-session'
import { getEntityFields, seedEntitySession, updateWatchlistItems } from '@/lib/yjs/entity-session'
import {
  decodeYjsLifecycleMessage,
  encodeYjsPersistRequest,
  YJS_MESSAGE_LIFECYCLE,
} from '@/lib/yjs/lifecycle-protocol'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  acquireDocument,
  cleanupAllDocuments,
  discardDocument,
  drainAllDocuments,
  drainYjsSessionTargets,
  flushDocumentPersistence,
  peekDocument,
  persistStagedDocuments,
  reconcileDocument,
  runDocumentMutation,
  setDocumentReconciler,
  setupWSConnection,
} from './upstream-utils'

const accessMocks = vi.hoisted(() => ({ verifyReviewTargetAccess: vi.fn() }))
const fenceMocks = vi.hoisted(() => {
  const readStore = { select: vi.fn() }
  const defaultAdmission = async (
    _target: unknown,
    use: (admit: (target: unknown) => Promise<void>, store: typeof readStore) => Promise<unknown>
  ) => use(async () => undefined, readStore)
  return { readStore, defaultAdmission, withAdmission: vi.fn(defaultAdmission) }
})

vi.mock('@/lib/copilot/review-sessions/permissions', () => ({
  verifyReviewTargetAccess: accessMocks.verifyReviewTargetAccess,
}))

vi.mock('@/lib/yjs/server/revocation-fence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/yjs/server/revocation-fence')>()),
  withYjsAdmissionTransaction: fenceMocks.withAdmission,
}))

class TestSocket extends EventEmitter {
  readyState = 1
  binaryType = 'arraybuffer'
  send = vi.fn((_message, _options, callback?: (error?: Error) => void) => callback?.())
  ping = vi.fn()
  close = vi.fn()
}

type TestPersistence = (docId: string, doc: Y.Doc) => Promise<void> | void

function setupWatchlistSocket(
  socket: TestSocket,
  docId: string,
  persist: TestPersistence,
  debounceMs = 0
): Promise<Y.Doc> {
  return acquireDocument(
    docId,
    { workspaceId: 'workspace-1', initialize: () => undefined },
    (doc) => {
      setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
        doc,
        userId: 'user-1',
        accessMode: 'write',
        descriptor: buildSavedEntityDescriptor('watchlist', docId, 'workspace-1'),
        onDocumentUpdate: persist,
        onDocumentUpdateDebounceMs: debounceMs,
      })
      return doc
    }
  )
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

function readMessageType(message: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(message))
}

function readCheckpoint(message: Uint8Array) {
  const decoder = decoding.createDecoder(message)
  expect(decoding.readVarUint(decoder)).toBe(YJS_MESSAGE_LIFECYCLE)
  const lifecycle = decodeYjsLifecycleMessage(decoder)
  if (lifecycle.type !== 'checkpoint') throw new Error('Expected checkpoint')
  return lifecycle
}

afterEach(() => {
  vi.useRealTimers()
  cleanupAllDocuments()
})

beforeEach(() => {
  accessMocks.verifyReviewTargetAccess.mockReset().mockResolvedValue({ hasAccess: true })
  fenceMocks.readStore.select.mockReset()
  fenceMocks.withAdmission.mockReset().mockImplementation(fenceMocks.defaultAdmission)
})

describe('shared document lifecycle', () => {
  const admission = (sessionId: string) => ({
    userId: 'user-1',
    accessMode: 'write' as const,
    descriptor: buildSavedEntityDescriptor('watchlist', sessionId, null),
  })

  it('hands pre-admission messages to the canonical connection listener', async () => {
    const source = new Y.Doc()
    source.getMap('fields').set('received', true)
    const socket = new TestSocket()
    const doc = await acquireDocument(
      'pre-admission-message',
      { workspaceId: 'workspace-1', initialize: () => undefined },
      (shared) => {
        setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
          doc: shared,
          userId: 'user-1',
          accessMode: 'write',
          descriptor: buildSavedEntityDescriptor(
            'watchlist',
            'pre-admission-message',
            'workspace-1'
          ),
          initialMessages: [createSyncUpdateMessage(Y.encodeStateAsUpdate(source))],
        })
        return shared
      }
    )

    await vi.waitFor(() => expect(doc.getMap('fields').get('received')).toBe(true))
    expect(socket.listenerCount('message')).toBe(1)
    socket.emit('close')
    source.destroy()
  })

  it('serves reconnect bursts from their reserved admission connections', async () => {
    const capacity = 30
    const allOuterConnections = deferred()
    const deadlocked = deferred()
    const transactionStores = new Set<unknown>()
    const workspaceAdmissions = new Set<unknown>()
    const authorizationCounts = new Map<unknown, number>()
    let activeOuterConnections = 0
    let directReads = 0
    let callerReads = 0
    let queuedSecondaryReads = 0

    const read = async (store: unknown) => {
      if (transactionStores.has(store)) {
        directReads += 1
        return
      }
      if (activeOuterConnections < capacity) {
        callerReads += 1
        return
      }
      queuedSecondaryReads += 1
      if (queuedSecondaryReads === capacity) deadlocked.resolve()
      await new Promise<never>(() => undefined)
    }

    fenceMocks.withAdmission.mockImplementation(async (_target, use) => {
      const store = { select: vi.fn() }
      transactionStores.add(store)
      activeOuterConnections += 1
      if (activeOuterConnections === capacity) allOuterConnections.resolve()
      await allOuterConnections.promise
      try {
        return await use(async () => void workspaceAdmissions.add(store), store)
      } finally {
        activeOuterConnections -= 1
      }
    })
    accessMocks.verifyReviewTargetAccess.mockImplementation(
      async (_userId, _descriptor, _accessMode, store) => {
        const count = authorizationCounts.get(store) ?? 0
        if (count === 1) expect(workspaceAdmissions.has(store)).toBe(true)
        authorizationCounts.set(store, count + 1)
        await read(store)
        return { hasAccess: true, workspaceId: 'workspace-1' }
      }
    )

    const reconnects = Array.from({ length: capacity }, (_, index) => {
      const sessionId = `reconnect-${index}`
      return acquireDocument(
        sessionId,
        {
          admission: admission(sessionId),
          initialize: async (doc, _actor, store) => {
            await read(store)
            setDocumentReconciler(doc, read)
            return { workspaceId: 'workspace-1' }
          },
        },
        () => read(undefined)
      )
    })

    await expect(
      Promise.race([
        Promise.all(reconnects).then(() => 'completed' as const),
        deadlocked.promise.then(() => 'deadlocked' as const),
      ])
    ).resolves.toBe('completed')
    expect(activeOuterConnections).toBe(0)
    expect(queuedSecondaryReads).toBe(0)
    expect(directReads).toBe(capacity * 4)
    expect(callerReads).toBe(capacity)
    expect([...authorizationCounts.values()]).toEqual(Array(capacity).fill(2))
  })

  it('stops a revoked actor before initialization or use', async () => {
    accessMocks.verifyReviewTargetAccess
      .mockResolvedValueOnce({ hasAccess: true, workspaceId: 'canonical-workspace' })
      .mockResolvedValueOnce({ hasAccess: false, workspaceId: 'canonical-workspace' })
    const initialize = vi.fn()
    const use = vi.fn()

    await expect(
      acquireDocument('denied-session', { admission: admission('denied-session'), initialize }, use)
    ).rejects.toMatchObject({ name: 'YjsAuthError', status: 403 })
    expect(initialize).not.toHaveBeenCalled()
    expect(use).not.toHaveBeenCalled()
  })

  it('reserves caller work before commit and a racing drain', async () => {
    const caller = deferred()
    const callerStarted = deferred()
    const initialize = vi.fn((doc: Y.Doc) => void doc.getMap('fields').set('value', 'before'))
    const first = acquireDocument('serialized-bootstrap', { initialize }, async (doc) => {
      callerStarted.resolve()
      await caller.promise
      return doc.getMap('fields').get('value')
    })
    await callerStarted.promise

    const doc = peekDocument('serialized-bootstrap')!
    const second = acquireDocument('serialized-bootstrap', { initialize }, () => undefined)
    const secondRejected = expect(second).rejects.toMatchObject({ status: 425 })
    let drainSettled = false
    const drain = discardDocument(doc).then(() => void (drainSettled = true))
    await Promise.resolve()

    expect(fenceMocks.withAdmission).toHaveBeenCalledOnce()
    expect(drainSettled).toBe(false)
    caller.resolve()
    await expect(first).resolves.toBe('before')
    await secondRejected
    await drain
    expect(initialize).toHaveBeenCalledOnce()
    expect(peekDocument('serialized-bootstrap')).toBeNull()
  })

  it('does not discard a replacement document through a stale reference', async () => {
    const staleSocket = new TestSocket()
    const stale = await setupWatchlistSocket(staleSocket, 'layout-replaced', vi.fn())
    expect(readMessageType(staleSocket.send.mock.calls[0]![0])).toBe(YJS_MESSAGE_LIFECYCLE)
    expect(readMessageType(staleSocket.send.mock.calls[1]![0])).toBe(0)
    const staleLineage = readCheckpoint(staleSocket.send.mock.calls[0]![0]).lineageId
    await discardDocument(stale)
    const replacementSocket = new TestSocket()
    const replacement = await setupWatchlistSocket(replacementSocket, 'layout-replaced', vi.fn())
    expect(readCheckpoint(replacementSocket.send.mock.calls[0]![0]).lineageId).not.toBe(
      staleLineage
    )
    const mutation = vi.fn()

    await discardDocument(stale)
    await expect(runDocumentMutation(stale, mutation)).rejects.toThrow('draining')

    expect(mutation).not.toHaveBeenCalled()
    expect(peekDocument('layout-replaced')).toBe(replacement)
  })

  it('retains a flushed lineage and checkpoints only after persistence', async () => {
    vi.useFakeTimers()
    const persist = vi.fn().mockRejectedValueOnce(new Error('database unavailable'))
    const firstSocket = new TestSocket()
    const first = await setupWatchlistSocket(firstSocket, 'watchlist-reconnect', persist, 60_000)
    const secondSocket = new TestSocket()
    const second = await setupWatchlistSocket(secondSocket, 'watchlist-reconnect', persist, 60_000)
    const initialMessageCount = firstSocket.send.mock.calls.length
    const secondInitialMessageCount = secondSocket.send.mock.calls.length
    const updateMessage = createSyncUpdateMessage(createFieldsUpdate(first, 'pending', true))
    firstSocket.emit('message', updateMessage)
    await vi.waitFor(() => expect(first.getMap('fields').get('pending')).toBe(true))
    expect(firstSocket.send).toHaveBeenCalledTimes(initialMessageCount)
    expect(secondSocket.send).toHaveBeenCalledTimes(secondInitialMessageCount + 1)
    expect(readMessageType(secondSocket.send.mock.calls.at(-1)![0])).toBe(0)
    await expect(flushDocumentPersistence(first)).rejects.toThrow('database unavailable')
    expect(firstSocket.send).toHaveBeenCalledTimes(initialMessageCount)
    await flushDocumentPersistence(first)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(firstSocket.send).toHaveBeenCalledTimes(initialMessageCount + 1))
    expect(readMessageType(firstSocket.send.mock.calls.at(-1)![0])).toBe(YJS_MESSAGE_LIFECYCLE)
    firstSocket.emit('error', new Error('Max payload size exceeded'))

    expect(peekDocument('watchlist-reconnect')).toBe(first)
    expect(second).toBe(first)
    secondSocket.emit('close')
    expect(peekDocument('watchlist-reconnect')).toBe(first)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(peekDocument('watchlist-reconnect')).toBeNull()
  })

  it('applies current canonicalization, keeps queued edits, and retains drafts after failure', async () => {
    const socket = new TestSocket()
    const release = deferred()
    let canonicalUpdate!: Uint8Array
    const descriptor = buildSavedEntityDescriptor('skill', 'skill-manual', 'workspace-1')
    const persist = vi.fn((doc: Y.Doc, requestId: string) =>
      persistStagedDocuments(
        [{ doc, mutate: (staged) => staged.getMap('fields').set('accepted', requestId) }],
        async ([staged]) => {
          const fields = staged!.getMap('fields')
          const beforeCanonicalization = Y.encodeStateVector(staged!)
          const content = String(fields.get('content'))
          if (requestId !== 'request-0') expect(content).toBe('saved')
          fields.set('content', requestId === 'request-0' ? content.trim() : 'canonical')
          canonicalUpdate = Y.encodeStateAsUpdate(staged!, beforeCanonicalization)
          if (requestId !== 'request-0') await release.promise
        },
        requestId
      )
    )
    const doc = await acquireDocument(
      'skill-manual',
      { workspaceId: 'workspace-1', initialize: () => undefined },
      (shared) => {
        setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
          doc: shared,
          userId: 'user-1',
          accessMode: 'write',
          descriptor,
          persist,
        })
        return shared
      }
    )
    const fields = doc.getMap('fields')
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'content', '  raw  ')))
    await vi.waitFor(() => expect(fields.get('content')).toBe('  raw  '))
    socket.emit('message', encodeYjsPersistRequest('request-0'))
    await vi.waitFor(() =>
      expect(fields.toJSON()).toEqual({ content: 'raw', accepted: 'request-0' })
    )

    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'content', 'saved')))
    await vi.waitFor(() => expect(fields.get('content')).toBe('saved'))
    const initialMessages = socket.send.mock.calls.length
    socket.emit('message', encodeYjsPersistRequest('request-1', 'Renamed skill'))
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))

    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'content', 'newer')))
    release.resolve()
    await vi.waitFor(() => expect(fields.get('content')).toBe('newer'))

    const checkpoint = readCheckpoint(socket.send.mock.calls.at(-1)![0])
    expect(persist).toHaveBeenCalledWith(doc, 'request-1', 'Renamed skill')
    expect(checkpoint.requestId).toBe('request-1')
    expect(Y.snapshotContainsUpdate(checkpoint.snapshot, canonicalUpdate)).toBe(true)
    expect(Y.snapshotContainsUpdate(Y.snapshot(doc), canonicalUpdate)).toBe(false)
    expect(fields.toJSON()).toEqual({ content: 'newer', accepted: 'request-1' })

    persist.mockRejectedValueOnce(new Error('database unavailable'))
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'draft', true)))
    socket.emit('message', encodeYjsPersistRequest('request-2'))
    await vi.waitFor(() => expect(socket.send).toHaveBeenCalledTimes(initialMessages + 3))
    const errorDecoder = decoding.createDecoder(socket.send.mock.calls.at(-1)![0])
    expect(decoding.readVarUint(errorDecoder)).toBe(YJS_MESSAGE_LIFECYCLE)
    expect(decodeYjsLifecycleMessage(errorDecoder)).toMatchObject({
      type: 'persist-error',
      requestId: 'request-2',
      error: 'database unavailable',
    })
    expect(fields.get('draft')).toBe(true)
    socket.emit('close')
  })

  it('flushes an edit newer than active persistence on disconnect', async () => {
    const socket = new TestSocket()
    const started = deferred()
    const release = deferred()
    let firstNormalization!: Uint8Array
    const persist = vi.fn(async (_docId: string, staged: Y.Doc) => {
      const fields = staged.getMap('fields')
      const beforeNormalization = Y.encodeStateVector(staged)
      if (persist.mock.calls.length === 1) {
        started.resolve()
        await release.promise
      }
      fields.set('canonical', fields.get('value'))
      if (persist.mock.calls.length === 1) {
        firstNormalization = Y.encodeStateAsUpdate(staged, beforeNormalization)
      }
    })
    const doc = await setupWatchlistSocket(socket, 'watchlist-generation', persist, 60_000)
    const fields = doc.getMap('fields')
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'value', 'A')))
    await vi.waitFor(() => expect(fields.get('value')).toBe('A'))
    const firstPersistence = runDocumentMutation(doc, () => flushDocumentPersistence(doc))
    await started.promise

    const updateB = createFieldsUpdate(doc, 'value', 'B')
    socket.emit('message', createSyncUpdateMessage(updateB))
    release.resolve()
    await firstPersistence
    await vi.waitFor(() => expect(fields.toJSON()).toEqual({ value: 'B' }))

    const checkpoint = readCheckpoint(socket.send.mock.calls.at(-1)![0])
    expect(Y.snapshotContainsUpdate(checkpoint.snapshot, firstNormalization)).toBe(true)
    expect(Y.snapshotContainsUpdate(checkpoint.snapshot, updateB)).toBe(false)

    socket.emit('close')
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))

    expect(fields.toJSON()).toEqual({ value: 'B', canonical: 'B' })
  })

  it('retries a failed shared-document reconciliation on the next heartbeat', async () => {
    vi.useFakeTimers()
    const sockets = [new TestSocket(), new TestSocket()]
    const descriptor = buildSavedEntityDescriptor('watchlist', 'watchlist-list', 'workspace-1')
    const listDoc = await acquireDocument(
      'list:watchlist:workspace-1',
      { workspaceId: 'workspace-1', initialize: () => undefined },
      (doc) => {
        for (const socket of sockets) {
          setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
            doc,
            userId: 'user-1',
            accessMode: 'read',
            descriptor,
          })
        }
        return doc
      }
    )
    const doc = peekDocument('list:watchlist:workspace-1')!
    doc.getMap('members').set('current', 'stale')
    const reconcile = vi.fn(() => {
      if (reconcile.mock.calls.length === 1) throw new Error('database unavailable')
      doc.transact(() => doc.getMap('members').set('current', 'canonical'), YJS_ORIGINS.SYSTEM)
    })
    setDocumentReconciler(doc, reconcile)

    try {
      await vi.advanceTimersByTimeAsync(15_000)
      await expect(reconcileDocument(doc, true)).rejects.toThrow('database unavailable')
      expect(reconcile).toHaveBeenCalledOnce()
      expect(doc.getMap('members').get('current')).toBe('stale')

      await vi.advanceTimersByTimeAsync(15_000)
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(doc.getMap('members').get('current')).toBe('canonical')
    } finally {
      sockets.forEach((socket) => socket.emit('close'))
    }
  })
})

describe('realtime shutdown', () => {
  it('persists an already-queued writer update before closing its socket', async () => {
    const socket = new TestSocket()
    const gate = deferred()
    const persistenceStarted = deferred()
    const persistence = deferred()
    const persisted = vi.fn(async (_docId: string, _doc: Y.Doc) => {
      persistenceStarted.resolve()
      await persistence.promise
    })
    const doc = await setupWatchlistSocket(socket, 'watchlist-queued-drain', persisted, 60_000)
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

    expect(persisted).toHaveBeenCalledOnce()
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(peekDocument('watchlist-queued-drain')).toBeNull()
  })

  it('keeps a failed drain fenced while allowing a later drain retry', async () => {
    const sockets = [new TestSocket(), new TestSocket()]
    const persist = [vi.fn(), vi.fn().mockRejectedValueOnce(new Error('database offline'))]
    for (const [index, socket] of sockets.entries()) {
      const docId = `watchlist-drain-${index}`
      const doc = await setupWatchlistSocket(socket, docId, persist[index], 60_000)
      doc.getMap('fields').set('pending', true)
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
    await expect(
      acquireDocument('new-during-drain', { initialize: () => undefined }, () => undefined)
    ).rejects.toThrow('not accepting connections')
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
    const terminalDoc = await setupWatchlistSocket(socket, 'watchlist-terminal-drain', persist)
    terminalDoc.getMap('fields').set('invalid', true)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())

    const unrelatedSocket = new TestSocket()
    const unrelatedPersist = vi.fn()
    const unrelatedDoc = await setupWatchlistSocket(
      unrelatedSocket,
      'watchlist-unrelated-drain',
      unrelatedPersist,
      60_000
    )
    unrelatedDoc.getMap('fields').set('pending', true)

    const draining = drainAllDocuments()
    rejectPersistence(error)
    await expect(draining).rejects.toBe(error)
    expect(socket.close).toHaveBeenCalledWith(
      YJS_CLOSE_CODE_DOCUMENT_REJECTED,
      'Canonical document rejected'
    )
    expect(peekDocument('watchlist-terminal-drain')).toBeNull()
    expect(unrelatedPersist).toHaveBeenCalledOnce()
    expect(unrelatedSocket.close).toHaveBeenCalledOnce()
    expect(peekDocument('watchlist-unrelated-drain')).toBeNull()
    await expect(drainAllDocuments()).rejects.toBe(error)
  })
})

describe('document mutation queue', () => {
  async function expectRejectedUpdate(input: {
    sessionId: string
    descriptor: ReviewTargetDescriptor
    seed: (doc: Y.Doc) => void
    prepareLive?: (doc: Y.Doc) => void
    mutate: (doc: Y.Doc) => void
    read: (doc: Y.Doc) => unknown
    afterReject?: () => void
  }) {
    const source = new Y.Doc()
    const sender = new TestSocket()
    const peer = new TestSocket()
    const persist = vi.fn()
    try {
      input.seed(source)
      const doc = await acquireDocument(
        input.sessionId,
        {
          workspaceId: input.descriptor.workspaceId,
          initialize: () => ({
            state: Y.encodeStateAsUpdate(source),
            validateDocument: input.read,
          }),
        },
        (doc) => {
          setupWSConnection(sender as unknown as WebSocket, {} as IncomingMessage, {
            doc,
            userId: 'user-1',
            accessMode: 'write',
            descriptor: input.descriptor,
            onDocumentUpdate: persist,
          })
          setupWSConnection(peer as unknown as WebSocket, {} as IncomingMessage, {
            doc,
            userId: 'user-1',
            accessMode: 'write',
            descriptor: input.descriptor,
          })
          return doc
        }
      )
      input.prepareLive?.(doc)
      const before = input.read(doc)
      const sentBeforeRejection = peer.send.mock.calls.length
      const senderMessagesBeforeRejection = sender.send.mock.calls.length

      const stateVector = Y.encodeStateVector(source)
      input.mutate(source)
      sender.emit('message', createSyncUpdateMessage(Y.encodeStateAsUpdate(source, stateVector)))
      await vi.waitFor(() =>
        expect(sender.close).toHaveBeenCalledWith(
          YJS_CLOSE_CODE_DOCUMENT_REJECTED,
          'Canonical document rejected'
        )
      )
      input.afterReject?.()
      expect(input.read(doc)).toEqual(before)
      expect(peer.close).not.toHaveBeenCalled()
      expect(peer.send).toHaveBeenCalledTimes(sentBeforeRejection)
      expect(sender.send).toHaveBeenCalledTimes(senderMessagesBeforeRejection)
      expect(persist).not.toHaveBeenCalled()
    } finally {
      sender.emit('close')
      peer.emit('close')
      source.destroy()
    }
  }

  it('rejects unsafe widget paths before merging them', async () => {
    await expectRejectedUpdate({
      sessionId: 'dashboard-widget:layout-1:widget-1',
      descriptor: buildDashboardWidgetDescriptor({
        layoutId: 'layout-1',
        identityId: 'widget-1',
        workspaceId: 'workspace-1',
        ownerUserId: 'user-1',
      }),
      seed: (doc) =>
        seedDashboardWidgetSession(doc, {
          pairColor: 'gray',
          params: { view: { interval: '1h' } },
        }),
      mutate: (doc) => {
        const params = getDashboardWidgetMap(doc).get('params')
        if (!(params instanceof Y.Map)) throw new Error('Expected widget params Y.Map')
        params.set(JSON.stringify(['__proto__', 'dashboardPolluted']), 'yes')
      },
      read: (doc) => readDashboardWidgetDocument(doc, 'data_chart'),
      afterReject: () => {
        expect((Object.prototype as Record<string, unknown>).dashboardPolluted).toBeUndefined()
        Reflect.deleteProperty(Object.prototype, 'dashboardPolluted')
      },
    })
  })

  it('enforces watchlist symbol limits', async () => {
    const identity = { listing_type: 'default' as const, listing_id: '', base_id: '', quote_id: '' }
    const cappedListing = (index: number) => ({
      id: `listing-${index}`,
      type: 'listing' as const,
      parentId: null,
      listing: { ...identity, listing_id: `SYM${index}` },
    })
    const settings = { showLogo: true, showTicker: true, showDescription: true }
    await expectRejectedUpdate({
      sessionId: 'watchlist-cap',
      descriptor: buildSavedEntityDescriptor('watchlist', 'watchlist-cap', 'workspace-1'),
      seed: (doc) =>
        seedEntitySession(doc, {
          entityKind: 'watchlist',
          payload: {
            settings,
            items: Array.from({ length: 999 }, (_, index) => cappedListing(index)),
          },
        }),
      prepareLive: (doc) =>
        updateWatchlistItems(doc, (items) => [...items, cappedListing(999)], YJS_ORIGINS.SYSTEM),
      mutate: (doc) => updateWatchlistItems(doc, (items) => [...items, cappedListing(1000)]),
      read: (doc) => getEntityFields(doc, 'watchlist'),
    })
  })

  it('serializes WebSocket writes behind an import and recovers after import failure', async () => {
    const source = new Y.Doc()
    source.getMap('fields').set('initial', true)
    const socket = new TestSocket()
    let database: Record<string, unknown> = {}
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      database = target.getMap('fields').toJSON()
    })
    const doc = await setupWatchlistSocket(socket, 'watchlist-1', persist)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), YJS_ORIGINS.SYSTEM)
    source.destroy()

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

  it('persists and retains dirty watchlist state after a pending mutation fails', async () => {
    const socket = new TestSocket()
    const persistedValue = vi.fn()
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      persistedValue(target.getMap('fields').get('dirty'))
    })
    const doc = await setupWatchlistSocket(socket, 'watchlist-cleanup', persist, 60_000)
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
    expect(peekDocument('watchlist-cleanup')).toBe(doc)
  })
})

describe('orderly document discard', () => {
  it('flushes accepted updates before an idempotent target drain completes', async () => {
    const socket = new TestSocket()
    const persistedValue = vi.fn()
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      persistedValue(target.getMap('fields').get('accepted'))
    })
    const doc = await setupWatchlistSocket(socket, 'drained-watchlist', persist, 60_000)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'accepted', true)))
    await vi.waitFor(() => expect(doc.getMap('fields').get('accepted')).toBe(true))
    expect(persist).not.toHaveBeenCalled()
    const mutationGate = deferred()
    const mutation = runDocumentMutation(doc, () => mutationGate.promise)

    const firstDrain = drainYjsSessionTargets({ workspaceIds: ['workspace-1'] })
    const duplicateDrain = drainYjsSessionTargets({ workspaceIds: ['workspace-1'] })
    await Promise.resolve()
    await expect(runDocumentMutation(doc, () => undefined)).rejects.toThrow('draining')
    expect(peekDocument('drained-watchlist')).toBe(doc)

    mutationGate.resolve()
    await mutation
    await Promise.all([firstDrain, duplicateDrain])
    expect(persistedValue).toHaveBeenCalledWith(true)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(peekDocument('drained-watchlist')).toBeNull()
    await expect(
      acquireDocument(
        'drained-watchlist',
        { workspaceId: 'workspace-1', initialize: () => undefined },
        () => undefined
      )
    ).resolves.toBeUndefined()
  })

  it('drains every saved-entity kind in the targeted workspace only', async () => {
    const watchlistSocket = new TestSocket()
    const skillSocket = new TestSocket()
    const otherWorkspaceSocket = new TestSocket()
    const connect = (
      socket: TestSocket,
      entityKind: 'watchlist' | 'skill',
      entityId: string,
      workspaceId: string
    ) =>
      acquireDocument(entityId, { workspaceId, initialize: () => undefined }, (doc) => {
        setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
          doc,
          userId: 'user-1',
          accessMode: 'write',
          descriptor: buildSavedEntityDescriptor(entityKind, entityId, workspaceId),
        })
        return doc
      })

    await connect(watchlistSocket, 'watchlist', 'watchlist-workspace-1', 'workspace-1')
    await connect(skillSocket, 'skill', 'skill-workspace-1', 'workspace-1')
    await connect(otherWorkspaceSocket, 'watchlist', 'watchlist-workspace-2', 'workspace-2')

    await drainYjsSessionTargets({ workspaceIds: ['workspace-1'] })

    expect(watchlistSocket.close).toHaveBeenCalledOnce()
    expect(skillSocket.close).toHaveBeenCalledOnce()
    expect(peekDocument('watchlist-workspace-1')).toBeNull()
    expect(peekDocument('skill-workspace-1')).toBeNull()
    expect(otherWorkspaceSocket.close).not.toHaveBeenCalled()
    expect(peekDocument('watchlist-workspace-2')).not.toBeNull()

    otherWorkspaceSocket.emit('close')
  })

  it('requires a drain target', async () => {
    await expect(drainYjsSessionTargets({})).rejects.toThrow('non-empty Yjs revocation target')
  })

  it('reopens a current document after a retryable discard flush failure', async () => {
    vi.useFakeTimers()
    const socket = new TestSocket()
    const persist = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database offline'))
      .mockResolvedValueOnce(undefined)
    const doc = await setupWatchlistSocket(socket, 'discard-retry', persist, 60_000)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'accepted', true)))
    await vi.waitFor(() => expect(doc.getMap('fields').get('accepted')).toBe(true))
    expect(persist).not.toHaveBeenCalled()
    const discarding = discardDocument(peekDocument('discard-retry')!)

    await expect(discarding).rejects.toThrow('database offline')
    expect(peekDocument('discard-retry')).toBe(doc)
    await expect(runDocumentMutation(doc, () => undefined)).resolves.toBeUndefined()

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
  })
})

describe('workspace connection authorization', () => {
  const descriptor = buildSavedEntityDescriptor('skill', 'skill-1', 'workspace-1')

  function connect() {
    const socket = new TestSocket()
    return acquireDocument(
      'skill-1',
      { workspaceId: 'workspace-1', initialize: () => undefined },
      (doc) => {
        setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
          doc,
          userId: 'user-1',
          accessMode: 'write',
          descriptor,
        })
        return socket
      }
    )
  }

  it('periodically closes a writer whose permission was downgraded', async () => {
    vi.useFakeTimers()
    const socket = await connect()
    accessMocks.verifyReviewTargetAccess.mockResolvedValueOnce({ hasAccess: false })

    await vi.advanceTimersByTimeAsync(30_000)
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalled())
    socket.emit('close')
  })

  it('closes a writer when queued update authorization cannot be verified', async () => {
    const socket = await connect()
    const doc = peekDocument('skill-1')!
    accessMocks.verifyReviewTargetAccess.mockRejectedValueOnce(new Error('database unavailable'))

    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'unverified', true)))
    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledOnce())

    expect(doc.getMap('fields').has('unverified')).toBe(false)
    socket.emit('close')
  })

  it('drops a queued writer update when its workspace is drained', async () => {
    const socket = await connect()
    const doc = peekDocument('skill-1')!
    const gate = deferred()
    const blocker = runDocumentMutation(doc, () => gate.promise)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'forbidden', true)))

    const draining = drainYjsSessionTargets({ workspaceIds: ['workspace-1'] })
    gate.resolve()
    await blocker
    await draining

    expect(doc.getMap('fields').has('forbidden')).toBe(false)
    expect(socket.close).toHaveBeenCalled()
    socket.emit('close')
  })
})
