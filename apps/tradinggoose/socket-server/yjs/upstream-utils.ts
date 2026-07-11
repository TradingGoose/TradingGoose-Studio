/**
 * Local adaptation of the upstream y-websocket server `src/utils.js` contract.
 *
 * Uses the app's single Yjs runtime and exposes only the helpers this repo
 * needs: `getDocument`, `getExistingDocument`, `peekDocument`,
 * `setupWSConnection`, `removeDocument`, `discardDocument`, and
 * `cleanupAllDocuments`.
 */

import type { IncomingMessage } from 'http'
import * as awarenessProtocol from '@y/protocols/awareness'
import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as map from 'lib0/map'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import type { ReviewAccessMode, ReviewTargetDescriptor } from '@/lib/copilot/review-sessions/types'
import {
  ensureDashboardLayoutDirtyTracker,
  isDashboardLayoutDirty,
} from '@/lib/yjs/dashboard-layout-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000

const docs = new Map<string, WSSharedDoc>()
type DocumentPersistenceHandler = (docId: string, doc: Y.Doc) => Promise<void> | void
type ConnectionState = {
  awarenessIds: Set<number>
  userId: string
  accessMode: ReviewAccessMode
  descriptor: ReviewTargetDescriptor
}

class WSSharedDoc extends Y.Doc {
  name: string
  conns: Map<WebSocket, ConnectionState>
  awareness: awarenessProtocol.Awareness
  whenInitialized: Promise<void>
  onDocumentIdle?: DocumentPersistenceHandler
  onDocumentUpdate?: DocumentPersistenceHandler
  retryPersistence?: DocumentPersistenceHandler
  onDocumentUpdateDebounceMs = 0
  hasUnsavedChanges = false
  changeGeneration = 0
  isPersisting = false
  pendingPersistRequests = 0
  persistenceQueue: Promise<void> = Promise.resolve()
  pendingMutations = 0
  mutationQueue: Promise<void> = Promise.resolve()
  persistTimer: ReturnType<typeof setTimeout> | null = null
  cleanupRequested = false

  constructor(name: string, gc: boolean) {
    super({ gc })
    this.name = name
    this.conns = new Map()
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on(
      'update',
      (
        { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
        conn: WebSocket | null
      ) => {
        const changedClients = added.concat(updated, removed)

        if (conn !== null) {
          const connection = this.conns.get(conn)
          if (connection !== undefined) {
            added.forEach((clientId) => connection.awarenessIds.add(clientId))
            removed.forEach((clientId) => connection.awarenessIds.delete(clientId))
          }
        }

        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageAwareness)
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
        )
        const message = encoding.toUint8Array(encoder)
        this.conns.forEach((_ids, currentConn) => send(this, currentConn, message))
      }
    )

    this.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== YJS_ORIGINS.SYSTEM) {
        this.changeGeneration += 1
        this.hasUnsavedChanges = true
        scheduleDocumentPersistence(this)
      }
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      this.conns.forEach((_ids, conn) => send(this, conn, message))
    })

    this.whenInitialized = Promise.resolve()
  }
}

function scheduleDocumentPersistence(doc: WSSharedDoc): void {
  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }

  if (doc.pendingPersistRequests > 0) {
    return
  }

  if (doc.onDocumentUpdateDebounceMs > 0) {
    doc.persistTimer = setTimeout(() => {
      doc.persistTimer = null
      void enqueueDocumentPersistence(doc, doc.onDocumentUpdate).catch((error) => {
        console.error('[yjs upstream-utils] Failed to persist live document', error)
      })
    }, doc.onDocumentUpdateDebounceMs)
    return
  }

  void enqueueDocumentPersistence(doc, doc.onDocumentUpdate).catch((error) => {
    console.error('[yjs upstream-utils] Failed to persist live document', error)
  })
}

function hasDashboardTracker(doc: WSSharedDoc): boolean {
  return doc.getMap('metadata').get('entityKind') === 'dashboard_layout'
}

function hasDirtyState(doc: WSSharedDoc): boolean {
  return doc.hasUnsavedChanges || (hasDashboardTracker(doc) && isDashboardLayoutDirty(doc))
}

function isDocumentIdle(doc: WSSharedDoc): boolean {
  return (
    !hasDirtyState(doc) &&
    !doc.isPersisting &&
    doc.pendingPersistRequests === 0 &&
    doc.pendingMutations === 0 &&
    doc.persistTimer === null
  )
}

function schedulePersistenceRetry(doc: WSSharedDoc): void {
  const persist = doc.onDocumentUpdate ?? doc.retryPersistence
  if (doc.persistTimer || doc.pendingPersistRequests > 0 || !persist) return
  doc.persistTimer = setTimeout(
    () => {
      doc.persistTimer = null
      void enqueueDocumentPersistence(doc, persist).catch((error) => {
        console.error('[yjs upstream-utils] Failed to retry document persistence', error)
      })
    },
    Math.max(doc.onDocumentUpdateDebounceMs, 1000)
  )
}

function enqueueDocumentPersistence(
  doc: WSSharedDoc,
  persist: DocumentPersistenceHandler | undefined
): Promise<void> {
  if (!persist) return doc.persistenceQueue

  const requestedGeneration = doc.changeGeneration
  doc.pendingPersistRequests += 1
  const run = doc.persistenceQueue.then(async () => {
    if (!hasDirtyState(doc)) return
    doc.isPersisting = true
    try {
      await persist(doc.name, doc)
      const hasNewerChanges = doc.changeGeneration !== requestedGeneration
      const dashboardDirty = hasDashboardTracker(doc) && isDashboardLayoutDirty(doc)
      doc.hasUnsavedChanges = hasNewerChanges || dashboardDirty
    } catch (error) {
      doc.hasUnsavedChanges = true
      throw error
    } finally {
      doc.isPersisting = false
    }
  })

  const settled = run.finally(() => {
    doc.pendingPersistRequests -= 1
    if (hasDirtyState(doc)) schedulePersistenceRetry(doc)
    if (doc.cleanupRequested && doc.conns.size === 0 && isDocumentIdle(doc)) {
      cleanupDocument(doc)
    }
  })
  doc.persistenceQueue = settled.catch(() => undefined)
  return settled
}

function cleanupDocument(doc: WSSharedDoc): void {
  if (docs.get(doc.name) !== doc) {
    return
  }

  if (doc.persistTimer) clearTimeout(doc.persistTimer)
  doc.persistTimer = null
  docs.delete(doc.name)
  doc.destroy()
}

function finalizeDocumentCleanup(doc: WSSharedDoc): void {
  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }

  doc.cleanupRequested = true
  if (doc.pendingMutations > 0) return
  if (isDocumentIdle(doc)) {
    cleanupDocument(doc)
    return
  }

  const persist = doc.onDocumentIdle ?? doc.onDocumentUpdate ?? doc.retryPersistence
  if (!persist) {
    cleanupDocument(doc)
    return
  }
  void enqueueDocumentPersistence(doc, persist).catch((error) => {
    console.error('[yjs upstream-utils] Failed to persist idle document', error)
  })
}

function send(doc: WSSharedDoc, conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn)
    return
  }

  try {
    conn.send(message, {}, (err) => {
      if (err != null) {
        closeConn(doc, conn)
      }
    })
  } catch {
    closeConn(doc, conn)
  }
}

function closeConn(doc: WSSharedDoc, conn: WebSocket): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn)?.awarenessIds ?? new Set<number>()
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)

    if (doc.conns.size === 0) {
      finalizeDocumentCleanup(doc)
    }
  }

  try {
    conn.close()
  } catch {
    // Connection may already be closed.
  }
}

function applySyncMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  const encoder = encoding.createEncoder()
  const decoder = decoding.createDecoder(message)
  decoding.readVarUint(decoder)
  encoding.writeVarUint(encoder, messageSync)
  syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
  if (encoding.length(encoder) > 1) {
    send(doc, conn, encoding.toUint8Array(encoder))
  }
}

function handleMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  try {
    const connection = doc.conns.get(conn)
    if (!connection) return
    const decoder = decoding.createDecoder(message)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case messageSync: {
        const syncMessageType = decoding.peekVarUint(decoder)
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          applySyncMessage(conn, doc, message)
          break
        }
        if (connection.accessMode === 'read') {
          closeConn(doc, conn)
          break
        }
        void runDocumentMutation(doc, () => {
          const current = doc.conns.get(conn)
          if (!current) return
          if (current.accessMode !== 'write') {
            closeConn(doc, conn)
            return
          }
          applySyncMessage(conn, doc, message)
        }).catch((error) => {
          console.error('[yjs upstream-utils] Error applying queued sync message', error)
        })
        break
      }
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        )
        break
      default:
        break
    }
  } catch (error) {
    console.error('[yjs upstream-utils] Error handling message', error)
  }
}

export function getDocument(docId: string, gc = true, bootstrapState?: Uint8Array): Y.Doc {
  return map.setIfUndefined(docs, docId, () => {
    const doc = new WSSharedDoc(docId, gc)
    if (bootstrapState) {
      Y.applyUpdate(doc, bootstrapState, YJS_ORIGINS.SYSTEM)
      doc.hasUnsavedChanges = false
    }
    if (hasDashboardTracker(doc)) ensureDashboardLayoutDirtyTracker(doc)
    return doc
  })
}

export function markDocumentPersisted(doc: Y.Doc): void {
  if (doc instanceof WSSharedDoc) {
    doc.hasUnsavedChanges = hasDashboardTracker(doc) && isDashboardLayoutDirty(doc)
  }
}

export function runDocumentMutation<T>(doc: Y.Doc, mutation: () => Promise<T> | T): Promise<T> {
  if (!(doc instanceof WSSharedDoc)) return Promise.resolve().then(mutation)

  doc.pendingMutations += 1
  const result = doc.mutationQueue.then(mutation)
  const settled = result.finally(() => {
    doc.pendingMutations -= 1
    if (doc.cleanupRequested && doc.conns.size === 0) {
      finalizeDocumentCleanup(doc)
    }
  })
  doc.mutationQueue = settled.then(
    () => undefined,
    () => undefined
  )
  return settled
}

export async function flushDocumentPersistence(
  doc: Y.Doc,
  persist?: DocumentPersistenceHandler
): Promise<void> {
  if (!(doc instanceof WSSharedDoc)) {
    if (persist) await persist('', doc)
    return
  }
  if (persist) doc.retryPersistence = persist
  if (hasDashboardTracker(doc)) ensureDashboardLayoutDirtyTracker(doc)
  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }
  await enqueueDocumentPersistence(doc, persist ?? doc.onDocumentUpdate ?? doc.onDocumentIdle)
}

export function peekDocument(docId: string): Y.Doc | null {
  return docs.get(docId) ?? null
}

export async function getExistingDocument(docId: string): Promise<Y.Doc | null> {
  const doc = docs.get(docId)
  if (!doc) {
    return null
  }

  await doc.whenInitialized
  return doc
}

export function setupWSConnection(
  conn: WebSocket,
  _req: IncomingMessage,
  opts: {
    docId: string
    userId: string
    accessMode: ReviewAccessMode
    descriptor: ReviewTargetDescriptor
    gc?: boolean
    bootstrapState?: Uint8Array
    onDocumentIdle?: DocumentPersistenceHandler
    onDocumentUpdate?: DocumentPersistenceHandler
    onDocumentUpdateDebounceMs?: number
  }
): void {
  const {
    docId,
    userId,
    accessMode,
    descriptor,
    gc = true,
    bootstrapState,
    onDocumentIdle,
    onDocumentUpdate,
    onDocumentUpdateDebounceMs,
  } = opts

  conn.binaryType = 'arraybuffer'

  const doc = getDocument(docId, gc, bootstrapState) as WSSharedDoc
  if (hasDashboardTracker(doc)) ensureDashboardLayoutDirtyTracker(doc)
  doc.onDocumentIdle = onDocumentIdle
  if (onDocumentUpdate) {
    doc.onDocumentUpdate = onDocumentUpdate
    doc.onDocumentUpdateDebounceMs = onDocumentUpdateDebounceMs ?? 0
  }
  doc.conns.set(conn, { awarenessIds: new Set(), userId, accessMode, descriptor })

  conn.on('message', (data: ArrayBuffer) => {
    void doc.whenInitialized.then(() => {
      handleMessage(conn, doc, new Uint8Array(data))
    })
  })

  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn)
      }
      clearInterval(pingInterval)
      return
    }

    if (doc.conns.has(conn)) {
      pongReceived = false
      try {
        conn.ping()
        const connection = doc.conns.get(conn)
        if (connection) {
          void reconcileConnection(doc, conn, connection).catch(() => closeConn(doc, conn))
        }
      } catch {
        closeConn(doc, conn)
        clearInterval(pingInterval)
      }
    }
  }, PING_TIMEOUT)

  conn.on('close', () => {
    closeConn(doc, conn)
    clearInterval(pingInterval)
  })

  conn.on('pong', () => {
    pongReceived = true
  })

  void doc.whenInitialized.then(() => {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    if (accessMode === 'read') {
      syncProtocol.writeSyncStep2(encoder, doc)
    } else {
      syncProtocol.writeSyncStep1(encoder, doc)
    }
    send(doc, conn, encoding.toUint8Array(encoder))

    const awarenessStates = doc.awareness.getStates()
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, messageAwareness)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys()))
      )
      send(doc, conn, encoding.toUint8Array(awarenessEncoder))
    }
  })
}

export function removeDocument(docId: string): void {
  const doc = docs.get(docId)
  if (!doc) {
    return
  }

  if (doc.conns.size === 0) {
    cleanupDocument(doc)
    return
  }

  doc.conns.forEach((_ids, conn) => {
    try {
      conn.close()
    } catch {
      // ignore
    }
  })
}

export function discardDocument(docId: string): void {
  const doc = docs.get(docId)
  if (!doc) {
    return
  }

  const conns = Array.from(doc.conns.keys())
  cleanupDocument(doc)
  conns.forEach((conn) => {
    try {
      conn.close()
    } catch {
      // ignore
    }
  })
}

export function discardDocumentIfIdle(docId: string): void {
  const doc = docs.get(docId)
  if (!doc || doc.conns.size > 0) return
  doc.cleanupRequested = true
  if (!isDocumentIdle(doc)) return

  cleanupDocument(doc)
}

async function reconcileConnection(
  doc: WSSharedDoc,
  conn: WebSocket,
  connection: ConnectionState
): Promise<void> {
  const access = await verifyReviewTargetAccess(
    connection.userId,
    connection.descriptor,
    connection.accessMode
  )
  if (!access.hasAccess && doc.conns.get(conn) === connection) closeConn(doc, conn)
}

export async function reconcileWorkspaceConnections(
  workspaceId: string,
  userIds?: ReadonlySet<string>
): Promise<void> {
  const checks: Promise<void>[] = []
  for (const doc of docs.values()) {
    for (const [conn, connection] of doc.conns) {
      if (connection.descriptor.workspaceId !== workspaceId) continue
      if (userIds && !userIds.has(connection.userId)) continue

      checks.push(reconcileConnection(doc, conn, connection))
    }
  }
  await Promise.all(checks)
}

export function cleanupAllDocuments(): void {
  for (const docId of Array.from(docs.keys())) {
    removeDocument(docId)
  }
}

export async function drainAllDocuments(): Promise<void> {
  const activeDocuments = Array.from(docs.values())
  for (const doc of activeDocuments) {
    for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn)
  }

  await Promise.all(
    activeDocuments.map(async (doc) => {
      await doc.mutationQueue
      if (docs.get(doc.name) !== doc) return
      if (doc.persistTimer) {
        clearTimeout(doc.persistTimer)
        doc.persistTimer = null
      }
      const persist = doc.onDocumentIdle ?? doc.onDocumentUpdate ?? doc.retryPersistence
      if (hasDirtyState(doc) && persist) await enqueueDocumentPersistence(doc, persist)
      await doc.persistenceQueue
      if (docs.get(doc.name) === doc) cleanupDocument(doc)
    })
  )
}
