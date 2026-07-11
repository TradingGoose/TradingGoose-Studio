import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'http'
import * as syncProtocol from '@y/protocols/sync'
import * as encoding from 'lib0/encoding'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import {
  beginDashboardLayoutDirtyFlush,
  completeDashboardLayoutDirtyFlush,
  failDashboardLayoutDirtyFlush,
  getDashboardLayoutMap,
  readDashboardLayoutTopology,
  seedDashboardLayoutSession,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { createDefaultDashboardLayoutContent } from '@/widgets/layout-document'
import {
  cleanupAllDocuments,
  discardDocumentIfIdle,
  drainAllDocuments,
  flushDocumentPersistence,
  getDocument,
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
  seedDashboardLayoutSession(source, createDefaultDashboardLayoutContent(), YJS_ORIGINS.SYSTEM)
  source.transact(() => {
    const metadata = source.getMap('metadata')
    metadata.set('entityKind', 'dashboard_layout')
    metadata.set('entityId', docId)
    metadata.set('workspaceId', 'workspace-1')
    metadata.set('ownerUserId', 'user-1')
  }, YJS_ORIGINS.SYSTEM)
  const state = Y.encodeStateAsUpdate(source)
  source.destroy()
  return getDocument(docId, true, state)
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
  it('serializes explicit flushes and preserves a newer generation during an in-flight save', async () => {
    const doc = createDashboardDocument('layout-serialized')
    const firstWrite = deferred()
    const savedTopologyIds: string[] = []
    let callCount = 0
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      const batch = beginDashboardLayoutDirtyFlush(target)
      expect(batch?.layout).toBe(true)
      callCount += 1
      savedTopologyIds.push(readDashboardLayoutTopology(target).id)
      if (callCount === 1) await firstWrite.promise
      completeDashboardLayoutDirtyFlush(target, batch!)
    })

    changeTopology(doc, 'first-generation')
    const firstFlush = flushDocumentPersistence(doc, persist)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(1))

    changeTopology(doc, 'second-generation')
    const secondFlush = flushDocumentPersistence(doc, persist)
    discardDocumentIfIdle('layout-serialized')
    expect(peekDocument('layout-serialized')).toBe(doc)

    firstWrite.resolve()
    await Promise.all([firstFlush, secondFlush])

    expect(persist).toHaveBeenCalledTimes(2)
    expect(savedTopologyIds).toEqual(['first-generation', 'second-generation'])
    discardDocumentIfIdle('layout-serialized')
    expect(peekDocument('layout-serialized')).toBeNull()
  })

  it('retries failed dirty state and completes requested idle cleanup', async () => {
    vi.useFakeTimers()
    const doc = createDashboardDocument('layout-retry')
    let attempts = 0
    const persist = vi.fn(async (_docId: string, target: Y.Doc) => {
      const batch = beginDashboardLayoutDirtyFlush(target)
      attempts += 1
      if (attempts === 1) {
        failDashboardLayoutDirtyFlush(target, batch!)
        throw new Error('database offline')
      }
      completeDashboardLayoutDirtyFlush(target, batch!)
    })

    changeTopology(doc, 'retry-generation')
    await expect(flushDocumentPersistence(doc, persist)).rejects.toThrow('database offline')
    discardDocumentIfIdle('layout-retry')
    expect(peekDocument('layout-retry')).toBe(doc)

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2))
    expect(peekDocument('layout-retry')).toBeNull()
  })
})

describe('realtime shutdown', () => {
  it('waits for queued mutations and persists dirty documents before cleanup', async () => {
    const descriptor = buildSavedEntityDescriptor('watchlist', 'watchlist-drain', 'workspace-1')
    const socket = new TestSocket()
    const mutation = deferred()
    const persisted = vi.fn()
    setupWSConnection(socket as unknown as WebSocket, {} as IncomingMessage, {
      docId: 'watchlist-drain',
      userId: 'user-1',
      accessMode: 'write',
      descriptor,
      onDocumentIdle: async (_docId, doc) => persisted(doc.getMap('fields').toJSON()),
      onDocumentUpdateDebounceMs: 60_000,
    })
    const doc = peekDocument('watchlist-drain')!
    doc.getMap('fields').set('pending', true)
    const queued = runDocumentMutation(doc, () => mutation.promise)

    const draining = drainAllDocuments()
    await new Promise((resolve) => setImmediate(resolve))
    expect(persisted).not.toHaveBeenCalled()
    mutation.resolve()
    await queued
    await draining

    expect(persisted).toHaveBeenCalledWith({ pending: true })
    expect(peekDocument('watchlist-drain')).toBeNull()
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
