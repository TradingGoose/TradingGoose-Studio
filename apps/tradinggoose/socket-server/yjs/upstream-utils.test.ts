import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import * as syncProtocol from '@y/protocols/sync'
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
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import {
  abortYjsSessionDeletion,
  beginYjsSessionDeletion,
  cleanupAllDocuments,
  commitYjsSessionDeletion,
  discardDocument,
  discardDocumentIfIdle,
  drainAllDocuments,
  flushDocumentPersistence,
  getDocument,
  isYjsSessionAdmissionBlocked,
  markDocumentPersisted,
  peekDocument,
  reconcileDocument,
  reconcileWorkspaceConnections,
  runDocumentMutation,
  setDocumentReconciler,
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

type TestPersistence = (docId: string, doc: Y.Doc) => Promise<void> | void

function setupWatchlistSocket(
  socket: TestSocket,
  docId: string,
  persist: TestPersistence,
  debounceMs = 0
): Y.Doc {
  setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
    docId,
    userId: 'user-1',
    accessMode: 'write',
    descriptor: buildSavedEntityDescriptor('watchlist', docId, 'workspace-1'),
    onDocumentUpdate: persist,
    onDocumentUpdateDebounceMs: debounceMs,
  })
  return peekDocument(docId)!
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

afterEach(() => {
  vi.useRealTimers()
  cleanupAllDocuments()
})

beforeEach(() => {
  accessMocks.verifyReviewTargetAccess.mockResolvedValue({ hasAccess: true })
})

describe('shared document lifecycle', () => {
  it('shares one document for its canonical workspace binding', () => {
    const first = getDocument('layout-bootstrap-race', true, undefined, 'workspace-1')
    const second = getDocument('layout-bootstrap-race', true, undefined, 'workspace-1')

    expect(first.created).toBe(true)
    expect(second).toEqual({ doc: first.doc, created: false })
  })

  it('does not discard a replacement document through a stale reference', async () => {
    const stale = getDocument('layout-replaced').doc
    discardDocumentIfIdle(stale)
    const replacement = getDocument('layout-replaced').doc
    const mutation = vi.fn()

    await discardDocument(stale)
    await expect(runDocumentMutation(stale, mutation)).rejects.toThrow('draining')

    expect(mutation).not.toHaveBeenCalled()
    expect(peekDocument('layout-replaced')).toBe(replacement)
  })

  it('flushes an edit newer than the last persisted generation before disconnect', async () => {
    const socket = new TestSocket()
    const persist = vi.fn()
    const doc = setupWatchlistSocket(socket, 'watchlist-generation', persist, 60_000)
    const persistedGeneration = await flushDocumentPersistence(doc)

    doc.getMap('fields').set('pending', true)
    markDocumentPersisted(doc, persistedGeneration)
    await discardDocument(doc)

    expect(persist).toHaveBeenCalledOnce()
  })

  it('retries a failed shared-document reconciliation once per heartbeat', async () => {
    vi.useFakeTimers()
    const sockets = [new TestSocket(), new TestSocket()]
    const descriptor = buildSavedEntityDescriptor('watchlist', 'watchlist-list', 'workspace-1')
    for (const socket of sockets) {
      setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
        docId: 'list:watchlist:workspace-1',
        userId: 'user-1',
        accessMode: 'read',
        descriptor,
      })
    }
    const doc = peekDocument('list:watchlist:workspace-1')!
    doc.getMap('members').set('current', 'stale')
    const reconcile = vi.fn(() => {
      if (reconcile.mock.calls.length === 1) throw new Error('database unavailable')
      doc.transact(() => doc.getMap('members').set('current', 'canonical'), YJS_ORIGINS.SYSTEM)
    })
    setDocumentReconciler(doc, reconcile)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      await vi.advanceTimersByTimeAsync(30_000)
      expect(reconcile).toHaveBeenCalledOnce()
      expect(doc.getMap('members').get('current')).toBe('stale')

      sockets.forEach((socket) => socket.emit('pong'))
      await vi.advanceTimersByTimeAsync(30_000)
      expect(reconcile).toHaveBeenCalledTimes(2)
      expect(doc.getMap('members').get('current')).toBe('canonical')
    } finally {
      consoleError.mockRestore()
      sockets.forEach((socket) => socket.emit('close'))
    }
  })

  it('coalesces forced reconciliation behind an in-flight database read', async () => {
    const doc = getDocument('list:watchlist:workspace-1').doc
    const gate = deferred()
    const reconcile = vi.fn(() => (reconcile.mock.calls.length === 1 ? gate.promise : undefined))
    setDocumentReconciler(doc, reconcile)
    void reconcileDocument(doc, true)
    const followUp = reconcileDocument(doc, true)
    const inFlight = Reflect.get(doc, 'reconciliationInFlight') as Promise<void>
    const joinGap = vi.fn(() => reconcileDocument(doc, true))
    void inFlight.then(joinGap)
    gate.resolve()
    await vi.waitFor(() => expect(joinGap).toHaveReturnedWith(followUp))
    await followUp
    expect(reconcile).toHaveBeenCalledTimes(2)
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
    const doc = setupWatchlistSocket(socket, 'watchlist-queued-drain', persisted, 60_000)
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
      setupWatchlistSocket(socket, docId, persist[index], 60_000)
        .getMap('fields')
        .set('pending', true)
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
    setupWatchlistSocket(socket, 'watchlist-terminal-drain', persist)
      .getMap('fields')
      .set('invalid', true)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())

    const unrelatedSocket = new TestSocket()
    const unrelatedPersist = vi.fn()
    setupWatchlistSocket(unrelatedSocket, 'watchlist-unrelated-drain', unrelatedPersist, 60_000)
      .getMap('fields')
      .set('pending', true)

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
      setupWSConnection(sender as unknown as WebSocket, {} as IncomingMessage, {
        docId: input.sessionId,
        userId: 'user-1',
        accessMode: 'write',
        descriptor: input.descriptor,
        bootstrapState: Y.encodeStateAsUpdate(source),
        onDocumentUpdate: persist,
        validateDocument: input.read,
      })
      setupWSConnection(peer as unknown as WebSocket, {} as IncomingMessage, {
        docId: input.sessionId,
        userId: 'user-1',
        accessMode: 'write',
        descriptor: input.descriptor,
        validateDocument: input.read,
      })
      const doc = peekDocument(input.sessionId)!
      input.prepareLive?.(doc)
      const before = input.read(doc)
      const sentBeforeRejection = peer.send.mock.calls.length

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

  it('rejects a concurrent watchlist update beyond the symbol limit before merging it', async () => {
    const identity = { listing_type: 'default' as const, listing_id: '', base_id: '', quote_id: '' }
    const listing = (index: number) => ({
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
          payload: { settings, items: Array.from({ length: 999 }, (_, index) => listing(index)) },
        }),
      prepareLive: (doc) =>
        updateWatchlistItems(doc, (items) => [...items, listing(999)], YJS_ORIGINS.SYSTEM),
      mutate: (doc) => updateWatchlistItems(doc, (items) => [...items, listing(1000)]),
      read: (doc) => getEntityFields(doc, 'watchlist'),
    })
  })

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
    const socket = new TestSocket()
    const persistedValue = vi.fn()
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      persistedValue(target.getMap('fields').get('dirty'))
    })
    const doc = setupWatchlistSocket(socket, 'watchlist-cleanup', persist, 60_000)
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
  it('flushes accepted updates before a deletion lease is aborted or committed', async () => {
    const descriptor = buildSavedEntityDescriptor('watchlist', 'leased-watchlist', 'workspace-1')
    const socket = new TestSocket()
    const persistedValue = vi.fn()
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      persistedValue(target.getMap('fields').get('accepted'))
    })
    getDocument('leased-watchlist', true, undefined, 'workspace-1')
    const doc = setupWatchlistSocket(socket, 'leased-watchlist', persist, 60_000)
    socket.emit('message', createSyncUpdateMessage(createFieldsUpdate(doc, 'accepted', true)))
    await vi.waitFor(() => expect(doc.getMap('fields').get('accepted')).toBe(true))
    expect(persist).not.toHaveBeenCalled()
    const mutationGate = deferred()
    const mutation = runDocumentMutation(doc, () => mutationGate.promise)

    const abortedLease = 'lease-abort'
    const firstBegin = beginYjsSessionDeletion(abortedLease, { workspaceIds: ['workspace-1'] })
    let duplicateReady = false
    const duplicateBegin = beginYjsSessionDeletion(abortedLease, {
      workspaceIds: ['workspace-1'],
    }).then(() => {
      duplicateReady = true
    })
    await Promise.resolve()
    expect(duplicateReady).toBe(false)
    await expect(
      beginYjsSessionDeletion(abortedLease, { workspaceIds: ['workspace-2'] })
    ).rejects.toThrow('not accepting connections')
    await expect(runDocumentMutation(doc, () => undefined)).rejects.toThrow('draining')
    expect(peekDocument('leased-watchlist')).toBe(doc)

    mutationGate.resolve()
    await mutation
    await Promise.all([firstBegin, duplicateBegin])
    expect(persistedValue).toHaveBeenCalledWith(true)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(peekDocument('leased-watchlist')).toBeNull()
    expect(isYjsSessionAdmissionBlocked('leased-watchlist', 'workspace-1')).toBe(true)
    expect(() =>
      setupWSConnection(new TestSocket() as unknown as WebSocket, {} as IncomingMessage, {
        docId: 'leased-watchlist',
        userId: 'user-1',
        accessMode: 'write',
        descriptor,
      })
    ).toThrow('not accepting connections')

    abortYjsSessionDeletion(abortedLease)
    abortYjsSessionDeletion(abortedLease)
    expect(isYjsSessionAdmissionBlocked('leased-watchlist', 'workspace-1')).toBe(false)

    const committedLease = 'lease-commit'
    await beginYjsSessionDeletion(committedLease, { sessionIds: ['deleted-watchlist'] })
    commitYjsSessionDeletion(committedLease)
    commitYjsSessionDeletion(committedLease)
    abortYjsSessionDeletion(committedLease)
    expect(isYjsSessionAdmissionBlocked('deleted-watchlist')).toBe(true)
    expect(() => getDocument('deleted-watchlist')).toThrow('not accepting connections')

    vi.useFakeTimers()
    const expiredLease = 'lease-expired'
    await beginYjsSessionDeletion(expiredLease, { sessionIds: ['orphaned-watchlist'] })
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1)
    await beginYjsSessionDeletion(expiredLease, { sessionIds: ['orphaned-watchlist'] })
    await vi.advanceTimersByTimeAsync(1)
    expect(isYjsSessionAdmissionBlocked('orphaned-watchlist')).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    expect(isYjsSessionAdmissionBlocked('orphaned-watchlist')).toBe(false)

    await beginYjsSessionDeletion('lease-cleanup', { sessionIds: ['cleanup-watchlist'] })
    cleanupAllDocuments()
    await vi.advanceTimersByTimeAsync(2.5 * 60_000)
    await beginYjsSessionDeletion('lease-cleanup', { sessionIds: ['cleanup-watchlist'] })
    await vi.advanceTimersByTimeAsync(2.5 * 60_000)
    expect(isYjsSessionAdmissionBlocked('cleanup-watchlist')).toBe(true)
    await vi.runOnlyPendingTimersAsync()
    expect(isYjsSessionAdmissionBlocked('cleanup-watchlist')).toBe(false)
  })

  it('requires a deletion target', async () => {
    await expect(beginYjsSessionDeletion('invalid-lease', {})).rejects.toThrow(
      'At least one non-empty Yjs deletion target is required'
    )
  })

  it('does not report an expired deletion lease as ready after its drain finishes', async () => {
    vi.useFakeTimers()
    const persistence = deferred()
    const socket = new TestSocket()
    const persist = vi.fn(() => persistence.promise)
    const doc = setupWatchlistSocket(socket, 'expired-lease-watchlist', persist, 60_000)
    doc.getMap('fields').set('dirty', true)

    const deleting = beginYjsSessionDeletion('lease-expiring-during-drain', {
      sessionIds: ['expired-lease-watchlist'],
    })
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce())
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    persistence.resolve()

    await expect(deleting).rejects.toThrow('not accepting connections')
    expect(isYjsSessionAdmissionBlocked('expired-lease-watchlist')).toBe(false)
  })

  it('reopens a current document after a retryable discard flush failure', async () => {
    vi.useFakeTimers()
    const socket = new TestSocket()
    const persist = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('database offline'))
      .mockResolvedValueOnce(undefined)
    const doc = setupWatchlistSocket(socket, 'discard-retry', persist, 60_000)
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
