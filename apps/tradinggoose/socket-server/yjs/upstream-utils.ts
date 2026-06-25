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

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000

const docs = new Map<string, WSSharedDoc>()
type DocumentIdleHandler = (docId: string, doc: Y.Doc) => Promise<void> | void

class WSSharedDoc extends Y.Doc {
  name: string
  conns: Map<WebSocket, Set<number>>
  awareness: awarenessProtocol.Awareness
  whenInitialized: Promise<void>
  onDocumentIdle?: DocumentIdleHandler

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
    })

    this.whenInitialized = Promise.resolve()
  }
}

function cleanupDocument(doc: WSSharedDoc): void {
  if (docs.get(doc.name) !== doc) {
    return
  }

  docs.delete(doc.name)
  doc.destroy()
}

function finalizeDocumentCleanup(doc: WSSharedDoc): void {
  if (!doc.onDocumentIdle) {
    cleanupDocument(doc)
    return
  }

  void Promise.resolve(doc.onDocumentIdle(doc.name, doc))
    .then(() => {
      if (doc.conns.size === 0) {
        cleanupDocument(doc)
      }
    })
    .catch((error) => {
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
    const controlledIds = doc.conns.get(conn) ?? new Set<number>()
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

export function getDocument(docId: string, gc = true, bootstrapState?: Uint8Array): Y.Doc {
  return map.setIfUndefined(docs, docId, () => {
    const doc = new WSSharedDoc(docId, gc)
    if (bootstrapState) {
      Y.applyUpdate(doc, bootstrapState)
    }
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
    bootstrapState?: Uint8Array
    onDocumentIdle?: DocumentIdleHandler
  }
): void {
  const { docId, gc = true, bootstrapState, onDocumentIdle } = opts

  conn.binaryType = 'arraybuffer'

  const doc = getDocument(docId, gc, bootstrapState) as WSSharedDoc
  doc.onDocumentIdle = onDocumentIdle
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
  if (!doc || doc.conns.size > 0) {
    return
  }

  cleanupDocument(doc)
}

export function cleanupAllDocuments(): void {
  for (const docId of Array.from(docs.keys())) {
    removeDocument(docId)
  }
}
