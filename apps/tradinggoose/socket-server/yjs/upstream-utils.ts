/**
 * Local adaptation of the upstream y-websocket server `src/utils.js` contract.
 *
 * Uses the app's single Yjs runtime and exposes only the helpers this repo
 * needs: `getDocument`, `getExistingDocument`, `peekDocument`,
 * `setupWSConnection`, `setPersistence`, `setContentInitializer`,
 * `removeDocument`, and `cleanupAllDocuments`.
 */

import * as Y from 'yjs'
import * as awarenessProtocol from '@y/protocols/awareness'
import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as map from 'lib0/map'
import * as mutex from 'lib0/mutex'
import type { IncomingMessage } from 'http'
import type { WebSocket } from 'ws'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000

export interface YjsPersistence {
  getState: (docId: string) => Promise<Uint8Array | null>
  storeState: (docId: string, state: Uint8Array) => Promise<void>
}

type ContentInitializer = (doc: Y.Doc) => Promise<void>

const docs = new Map<string, WSSharedDoc>()
const persistenceMap = new Map<string, YjsPersistence>()
const contentInitializerMap = new Map<string, ContentInitializer>()

class WSSharedDoc extends Y.Doc {
  name: string
  conns: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness
  whenInitialized: Promise<void>

  private persistScheduled = false
  private persistInFlight = false
  private persistPending = false
  private readonly schedulePersistMutex = mutex.createMutex()

  constructor(name: string, gc: boolean) {
    super({ gc })
    this.name = name
    this.conns = new Map()
    this.awareness = new awarenessProtocol.Awareness(this)
    this.awareness.setLocalState(null)

    this.awareness.on(
      'update',
      (
        {
          added,
          updated,
          removed,
        }: { added: number[]; updated: number[]; removed: number[] },
        conn: WebSocket | null
      ) => {
        const changedClients = added.concat(updated, removed)

        if (conn !== null) {
          const controlledIds = this.conns.get(conn)
          if (controlledIds !== undefined) {
            added.forEach((clientId) => controlledIds.add(clientId))
            removed.forEach((clientId) => controlledIds.delete(clientId))
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

    this.on('update', (update: Uint8Array, _origin: unknown) => {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      const message = encoding.toUint8Array(encoder)
      this.conns.forEach((_ids, conn) => send(this, conn, message))
      this.schedulePersist()
    })

    this.whenInitialized = this.initialize()
  }

  private async initialize(): Promise<void> {
    const persistence = persistenceMap.get(this.name)
    if (persistence) {
      const stored = await persistence.getState(this.name)
      if (stored) {
        Y.applyUpdate(this, stored)
      }
    }

    const initializer = contentInitializerMap.get(this.name)
    if (initializer) {
      await initializer(this)
    }
  }

  private schedulePersist(): void {
    this.schedulePersistMutex(() => {
      if (this.persistScheduled) {
        this.persistPending = true
        return
      }

      this.persistScheduled = true
      queueMicrotask(() => {
        this.persistScheduled = false
        void this.flushPersistence()
      })
    })
  }

  /**
   * Flush pending changes to the persistence backend.
   *
   * TODO(EFF-14): Switch to incremental encoding once the persistence layer
   * supports appending deltas rather than full-state replacement.
   * The approach would be:
   *   1. Store `lastSavedStateVector = Y.encodeStateVector(this)` after each
   *      successful persist.
   *   2. On flush, encode only the delta:
   *      `Y.encodeStateAsUpdate(this, this.lastSavedStateVector)`
   *   3. The persistence layer would need to merge the delta into the stored
   *      state (e.g. apply it to a scratch Y.Doc and re-encode, or store a
   *      log of incremental updates and compact periodically).
   * Currently the persistence API is replace-only (`storeState` overwrites),
   * so incremental deltas would lose earlier state on reload.
   */
  async flushPersistence(): Promise<void> {
    if (this.persistInFlight) {
      this.persistPending = true
      return
    }

    this.persistInFlight = true

    try {
      const persistence = persistenceMap.get(this.name)
      if (!persistence) {
        return
      }

      do {
        this.persistPending = false
        const state = Y.encodeStateAsUpdate(this)
        await persistence.storeState(this.name, state)
      } while (this.persistPending)
    } finally {
      this.persistInFlight = false
    }
  }
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
    const controlledIds = doc.conns.get(conn) ?? new Set<number>()
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)

    if (doc.conns.size === 0) {
      docs.delete(doc.name)
      persistenceMap.delete(doc.name)
      contentInitializerMap.delete(doc.name)
      void doc
        .flushPersistence()
        .catch(() => {})
        .finally(() => {
          doc.destroy()
        })
    }
  }

  try {
    conn.close()
  } catch {
    // Connection may already be closed.
  }
}

function handleMessage(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  try {
    const encoder = encoding.createEncoder()
    const decoder = decoding.createDecoder(message)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder))
        }
        break
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

export function getDocument(docId: string, gc = true): Y.Doc {
  return map.setIfUndefined(docs, docId, () => {
    const doc = new WSSharedDoc(docId, gc)
    docs.set(docId, doc)
    return doc
  })
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
    gc?: boolean
    persistence?: YjsPersistence
    context?: unknown
  }
): void {
  const { docId, gc = true, persistence } = opts

  if (persistence && !persistenceMap.has(docId)) {
    persistenceMap.set(docId, persistence)
  }

  conn.binaryType = 'arraybuffer'

  const doc = getDocument(docId, gc) as WSSharedDoc
  doc.conns.set(conn, new Set())

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
    syncProtocol.writeSyncStep1(encoder, doc)
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

export function setPersistence(
  docId: string,
  hooks: {
    getState: (docId: string) => Promise<Uint8Array | null>
    storeState: (docId: string, state: Uint8Array) => Promise<void>
  }
): void {
  persistenceMap.set(docId, hooks)
}

export function setContentInitializer(docId: string, fn: (doc: Y.Doc) => Promise<void>): void {
  contentInitializerMap.set(docId, fn)
}

export function removeDocument(docId: string): void {
  const doc = docs.get(docId)
  if (!doc) {
    return
  }

  doc.conns.forEach((_ids, conn) => {
    try {
      conn.close()
    } catch {
      // ignore
    }
  })
  doc.conns.clear()

  doc.destroy()
  docs.delete(docId)
  persistenceMap.delete(docId)
  contentInitializerMap.delete(docId)
}

export function cleanupAllDocuments(): void {
  for (const docId of Array.from(docs.keys())) {
    removeDocument(docId)
  }
}
