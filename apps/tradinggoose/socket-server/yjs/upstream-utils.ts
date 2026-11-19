/**
 * Local adaptation of the upstream y-websocket server `src/utils.js` contract.
 *
 * Uses the app's single Yjs runtime and exposes only the helpers this repo
 * needs: `acquireDocument`, `peekDocument`, `setupWSConnection`,
 * `discardDocument` and `cleanupAllDocuments`.
 */

import type { IncomingMessage } from 'http'
import * as awarenessProtocol from '@y/protocols/awareness'
import * as syncProtocol from '@y/protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { WebSocket } from 'ws'
import * as Y from 'yjs'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import {
  type ReviewAccessMode,
  type ReviewTargetDescriptor,
  YJS_CLOSE_CODE_AUTHORIZATION_REVOKED,
  YJS_CLOSE_CODE_DOCUMENT_REJECTED,
} from '@/lib/copilot/review-sessions/types'
import {
  decodeYjsLifecycleMessage,
  encodeYjsDurableCheckpoint,
  encodeYjsPersistError,
  YJS_MESSAGE_LIFECYCLE,
} from '@/lib/yjs/lifecycle-protocol'
import {
  normalizeYjsRevocationTarget,
  withYjsAdmissionTransaction,
  type YjsRevocationTarget,
  type YjsRevocationTransaction,
  YjsSessionAdmissionError,
} from '@/lib/yjs/server/revocation-fence'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { YjsAuthError } from './auth'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000
const DOCUMENT_RETENTION_MS = 5 * 60_000

const docs = new Map<string, WSSharedDoc>()
let isDrainingAllDocuments = false
let terminalPersistenceError: Error | null = null
type DocumentPersistenceHandler = (docId: string, staged: Y.Doc) => Promise<void> | void
type DocumentReadStore = Pick<YjsRevocationTransaction, 'select'>
type DocumentInitialization = {
  state?: Uint8Array
  workspaceId?: string | null
  validateDocument?: DocumentValidator
}
type DocumentInitializer = (
  doc: Y.Doc,
  admission: DocumentAdmission | undefined,
  readStore: DocumentReadStore
) => Promise<DocumentInitialization | undefined> | DocumentInitialization | undefined
export type DocumentAdmission = {
  userId: string
  accessMode: ReviewAccessMode
  descriptor: ReviewTargetDescriptor
}
export type DocumentReconciler = (readStore?: DocumentReadStore) => Promise<void> | void
export type DocumentValidator = (doc: Y.Doc) => void
type ConnectionState = {
  awarenessIds: Set<number>
  userId: string
  accessMode: ReviewAccessMode
  descriptor: ReviewTargetDescriptor
  persist?: (doc: Y.Doc, requestId: string, identityName?: string) => Promise<void>
}

export class YjsDocumentDrainingError extends Error {
  constructor() {
    super('Yjs document is draining')
    this.name = 'YjsDocumentDrainingError'
  }
}

class WSSharedDoc extends Y.Doc {
  name: string
  workspaceId: string | null
  seeded: boolean
  persistedSnapshot = Y.emptySnapshot
  conns: Map<WebSocket, ConnectionState>
  awareness: awarenessProtocol.Awareness
  onDocumentUpdate?: DocumentPersistenceHandler
  onDocumentReconcile?: DocumentReconciler
  validateDocument?: DocumentValidator
  onDocumentUpdateDebounceMs = 0
  hasUnsavedChanges = false
  changeGeneration = 0
  isPersisting = false
  pendingPersistRequests = 0
  persistenceQueue: Promise<void> = Promise.resolve()
  pendingMutations = 0
  mutationQueue: Promise<void> = Promise.resolve()
  lastReconciliationAt = 0
  isDraining = false
  persistTimer: ReturnType<typeof setTimeout> | null = null
  retentionTimer: ReturnType<typeof setTimeout> | null = null
  retainUntil: number | null = null

  constructor(name: string, gc: boolean, workspaceId: string | null, seeded: boolean) {
    super({ gc })
    this.name = name
    this.workspaceId = workspaceId
    this.seeded = seeded
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
      this.conns.forEach((_ids, conn) => conn !== origin && send(this, conn, message))
    })
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

function isDocumentIdle(doc: WSSharedDoc): boolean {
  return (
    (!doc.hasUnsavedChanges || !doc.onDocumentUpdate) &&
    !doc.isPersisting &&
    doc.pendingPersistRequests === 0 &&
    doc.pendingMutations === 0 &&
    doc.persistTimer === null
  )
}

function schedulePersistenceRetry(doc: WSSharedDoc): void {
  const persist = doc.onDocumentUpdate
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

function releaseDocument(candidate: Y.Doc): void {
  if (!(candidate instanceof WSSharedDoc)) return
  const doc = candidate
  if (
    docs.get(doc.name) !== doc ||
    doc.conns.size > 0 ||
    doc.pendingMutations > 0 ||
    doc.pendingPersistRequests > 0 ||
    doc.isPersisting
  ) {
    return
  }

  if (doc.isDraining) {
    if (isDocumentIdle(doc)) cleanupDocument(doc)
    return
  }

  if (doc.hasUnsavedChanges && doc.onDocumentUpdate) {
    void flushDocumentPersistence(doc).catch((error) => {
      console.error('[yjs upstream-utils] Failed to persist released document', error)
    })
    return
  }

  if (doc.retainUntil === null) {
    cleanupDocument(doc)
    return
  }
  if (doc.retentionTimer) return
  doc.retentionTimer = setTimeout(
    () => {
      doc.retentionTimer = null
      doc.retainUntil = null
      releaseDocument(doc)
    },
    Math.max(0, doc.retainUntil - Date.now())
  )
}

function enqueueDocumentPersistence(
  doc: WSSharedDoc,
  persist: DocumentPersistenceHandler | undefined
): Promise<void> {
  if (!persist) return doc.persistenceQueue

  doc.pendingPersistRequests += 1
  const run = doc.persistenceQueue.then(async () => {
    if (!doc.hasUnsavedChanges) return
    const requestedGeneration = doc.changeGeneration
    const staged = new Y.Doc()
    doc.isPersisting = true
    try {
      Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
      const stagedStateVector = Y.encodeStateVector(staged)
      await persist(doc.name, staged)
      const hasNewerChanges = doc.changeGeneration !== requestedGeneration
      if (!hasNewerChanges && doc.pendingMutations === 0) {
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged, stagedStateVector), YJS_ORIGINS.SYSTEM)
      }
      publishPersistedSnapshot(doc, Y.snapshot(staged))
      doc.hasUnsavedChanges = hasNewerChanges
    } catch (error) {
      if ((error as { retryable?: unknown } | null)?.retryable !== false) {
        doc.hasUnsavedChanges = true
      } else {
        terminalPersistenceError ??= error as Error
        doc.hasUnsavedChanges = false
        doc.isDraining = true
        for (const conn of Array.from(doc.conns.keys())) {
          closeConn(doc, conn, YJS_CLOSE_CODE_DOCUMENT_REJECTED, 'Canonical document rejected')
        }
      }
      throw error
    } finally {
      doc.isPersisting = false
      staged.destroy()
    }
  })

  const settled = run.finally(() => {
    doc.pendingPersistRequests -= 1
    if (!doc.isDraining && doc.hasUnsavedChanges) schedulePersistenceRetry(doc)
    if (doc.isDraining || !doc.hasUnsavedChanges) releaseDocument(doc)
  })
  doc.persistenceQueue = settled.catch(() => undefined)
  return settled
}

function publishPersistedSnapshot(
  doc: WSSharedDoc,
  snapshot: Y.Snapshot,
  requestId?: string
): void {
  doc.persistedSnapshot = snapshot
  const message = encodeYjsDurableCheckpoint(doc.guid, snapshot, requestId)
  doc.conns.forEach((_state, conn) => send(doc, conn, message))
}

function cleanupDocument(doc: WSSharedDoc): void {
  if (docs.get(doc.name) !== doc) {
    return
  }

  if (doc.persistTimer) clearTimeout(doc.persistTimer)
  doc.persistTimer = null
  if (doc.retentionTimer) clearTimeout(doc.retentionTimer)
  doc.retentionTimer = null
  docs.delete(doc.name)
  doc.destroy()
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

function closeConn(doc: WSSharedDoc, conn: WebSocket, code?: number, reason?: string): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn)?.awarenessIds ?? new Set<number>()
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)

    if (doc.conns.size === 0) {
      doc.retainUntil = Date.now() + DOCUMENT_RETENTION_MS
      releaseDocument(doc)
    }
  }

  try {
    code === undefined ? conn.close() : conn.close(code, reason)
  } catch {
    // Connection may already be closed.
  }
}

function applySyncMessage(
  conn: WebSocket,
  doc: WSSharedDoc,
  message: Uint8Array,
  validate = true
): void {
  const encoder = encoding.createEncoder()
  const decoder = decoding.createDecoder(message)
  decoding.readVarUint(decoder)
  encoding.writeVarUint(encoder, messageSync)
  if (!validate || !doc.validateDocument) {
    syncProtocol.readSyncMessage(decoder, encoder, doc, conn)
  } else {
    const liveState = Y.encodeStateVector(doc)
    const staged = new Y.Doc()
    try {
      Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
      syncProtocol.readSyncMessage(decoder, encoder, staged, conn)
      doc.validateDocument(staged)
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged, liveState), conn)
    } catch {
      closeConn(doc, conn, YJS_CLOSE_CODE_DOCUMENT_REJECTED, 'Canonical document rejected')
      return
    } finally {
      staged.destroy()
    }
  }
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
          applySyncMessage(conn, doc, message, false)
          break
        }
        if (connection.accessMode === 'read') {
          closeConn(doc, conn)
          break
        }
        void runDocumentMutation(doc, () => {
          const current = doc.conns.get(conn)
          if (!current) return
          return reconcileConnection(doc, conn, current).then(() => {
            if (doc.conns.get(conn) !== current) return
            applySyncMessage(conn, doc, message)
          })
        }).catch((error) => {
          if (error instanceof YjsDocumentDrainingError) {
            closeConn(doc, conn)
            return
          }
          console.error('[yjs upstream-utils] Error applying queued sync message', error)
          closeConn(doc, conn)
        })
        break
      }
      case YJS_MESSAGE_LIFECYCLE: {
        const request = decodeYjsLifecycleMessage(decoder)
        if (request.type !== 'persist-request' || !connection.persist) {
          const requestId = request.type === 'persist-request' ? request.requestId : ''
          send(doc, conn, encodeYjsPersistError(requestId, 'Persistence is not available'))
          break
        }
        void runDocumentMutation(doc, async () => {
          const current = doc.conns.get(conn)
          if (!current) return
          await reconcileConnection(doc, conn, current)
          if (doc.conns.get(conn) !== current || !current.persist) return
          await current.persist(doc, request.requestId, request.identityName)
        }).catch((error) => {
          if (!doc.conns.has(conn)) return
          const message = error instanceof Error ? error.message : 'Failed to persist document'
          send(doc, conn, encodeYjsPersistError(request.requestId, message))
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

export async function acquireDocument<T>(
  docId: string,
  options: {
    gc?: boolean
    workspaceId?: string | null
    admission?: DocumentAdmission
    initialize: DocumentInitializer
  },
  use: (doc: Y.Doc, admission?: DocumentAdmission) => Promise<T> | T
): Promise<T> {
  const workspaceIds = options.workspaceId ? [options.workspaceId] : undefined
  assertLocalDocumentAdmission(docId)
  let doc = docs.get(docId)
  if (!doc) {
    doc = new WSSharedDoc(docId, options.gc ?? true, options.workspaceId ?? null, false)
    docs.set(docId, doc)
  }
  return runDocumentMutation(doc, async () => {
    assertLocalDocumentAdmission(docId)
    const admission = options.admission ? { ...options.admission } : undefined
    await withYjsAdmissionTransaction(
      { sessionIds: [docId], workspaceIds },
      async (admit, readStore) => {
        assertLocalDocumentAdmission(docId)
        const authorize = async (expectedWorkspaceId?: string | null) => {
          if (!admission) return null
          const access = await verifyReviewTargetAccess(
            admission.userId,
            admission.descriptor,
            admission.accessMode,
            readStore
          )
          if (
            !access.hasAccess ||
            (expectedWorkspaceId && access.workspaceId !== expectedWorkspaceId)
          ) {
            throw new YjsAuthError(403, 'Forbidden')
          }
          admission.descriptor = {
            ...admission.descriptor,
            workspaceId: access.workspaceId,
          }
          return access.workspaceId
        }
        let admittedWorkspaceId = options.workspaceId
        const admitWorkspace = async (workspaceId?: string | null) => {
          if (!workspaceId || workspaceId === admittedWorkspaceId) return
          await admit({ workspaceIds: [workspaceId] })
          admittedWorkspaceId = workspaceId
          await authorize(workspaceId)
        }
        await admitWorkspace(await authorize())
        await admitWorkspace(doc.workspaceId)
        if (!doc.seeded) {
          const resolved = await options.initialize(doc, admission, readStore)
          if (resolved?.workspaceId !== undefined) doc.workspaceId = resolved.workspaceId
          await admitWorkspace(doc.workspaceId)
          if (resolved?.state) Y.applyUpdate(doc, resolved.state, YJS_ORIGINS.SYSTEM)
          doc.validateDocument = resolved?.validateDocument
          doc.seeded = true
          doc.hasUnsavedChanges = false
          doc.persistedSnapshot = Y.snapshot(doc)
        }
        if (doc.onDocumentReconcile) await doc.onDocumentReconcile(readStore)
      }
    )
    return use(doc, admission)
  })
}

export async function persistStagedDocuments<T>(
  targets: Array<{ doc: Y.Doc; mutate?: (staged: Y.Doc) => void }>,
  persist: (staged: Y.Doc[]) => Promise<T>,
  requestId?: string
): Promise<T> {
  const generations = await Promise.all(targets.map(({ doc }) => flushDocumentPersistence(doc)))
  const liveStates = targets.map(({ doc }) => Y.encodeStateVector(doc))
  const staging = targets.map(({ doc }) => {
    const staged = new Y.Doc()
    Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
    return staged
  })
  try {
    targets.forEach(({ mutate }, index) => mutate?.(staging[index]!))
    const mutations = staging.map((doc, index) => Y.encodeStateAsUpdate(doc, liveStates[index]))
    const result = await persist(staging)
    targets.forEach(({ doc }, index) => {
      const isCurrent =
        !(doc instanceof WSSharedDoc) ||
        (doc.changeGeneration === generations[index] && doc.pendingMutations <= 1)
      if (isCurrent) mutations[index] = Y.encodeStateAsUpdate(staging[index]!, liveStates[index])
      Y.applyUpdate(doc, mutations[index]!, YJS_ORIGINS.SYSTEM)
      if (!(doc instanceof WSSharedDoc)) return
      publishPersistedSnapshot(doc, Y.snapshot(staging[index]!), requestId)
      if (isCurrent) doc.hasUnsavedChanges = false
    })
    return result
  } finally {
    staging.forEach((doc) => doc.destroy())
  }
}

export function runDocumentMutation<T>(doc: Y.Doc, mutation: () => Promise<T> | T): Promise<T> {
  if (!(doc instanceof WSSharedDoc)) return Promise.resolve().then(mutation)
  if (docs.get(doc.name) !== doc || doc.isDraining) {
    return Promise.reject(new YjsDocumentDrainingError())
  }

  doc.pendingMutations += 1
  const result = doc.mutationQueue.then(mutation)
  const settled = result.finally(() => {
    doc.pendingMutations -= 1
    releaseDocument(doc)
  })
  doc.mutationQueue = settled.then(
    () => undefined,
    () => undefined
  )
  return settled
}

export function setDocumentReconciler(doc: Y.Doc, reconcile: DocumentReconciler): void {
  if (!(doc instanceof WSSharedDoc) || docs.get(doc.name) !== doc || doc.isDraining) {
    throw new YjsDocumentDrainingError()
  }
  doc.onDocumentReconcile = reconcile
}

export function reconcileDocument(doc: Y.Doc, force = false): Promise<void> {
  if (!(doc instanceof WSSharedDoc)) return Promise.resolve()
  if (docs.get(doc.name) !== doc || doc.isDraining) {
    return Promise.reject(new YjsDocumentDrainingError())
  }
  if (
    !doc.onDocumentReconcile ||
    (!force && Date.now() - doc.lastReconciliationAt < PING_TIMEOUT)
  ) {
    return Promise.resolve()
  }

  doc.lastReconciliationAt = Date.now()
  const reconciliation = runDocumentMutation(doc, doc.onDocumentReconcile)
  reconciliation.catch(() => {
    doc.lastReconciliationAt = 0
  })
  return reconciliation
}

export async function flushDocumentPersistence(doc: Y.Doc): Promise<number> {
  if (!(doc instanceof WSSharedDoc)) return 0
  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }
  await enqueueDocumentPersistence(doc, doc.onDocumentUpdate)
  return doc.changeGeneration
}

export function peekDocument(docId: string): Y.Doc | null {
  const doc = docs.get(docId)
  return doc?.seeded ? doc : null
}

function assertLocalDocumentAdmission(docId: string): void {
  if (!isDrainingAllDocuments && docs.get(docId)?.isDraining !== true) return
  throw new YjsSessionAdmissionError(docId)
}

export function setupWSConnection(
  conn: WebSocket,
  _req: IncomingMessage,
  opts: {
    doc: Y.Doc
    userId: string
    accessMode: ReviewAccessMode
    descriptor: ReviewTargetDescriptor
    initialMessages?: readonly Uint8Array[]
    persist?: (doc: Y.Doc, requestId: string, identityName?: string) => Promise<void>
    onDocumentUpdate?: DocumentPersistenceHandler
    onDocumentUpdateDebounceMs?: number
  }
): void {
  const {
    doc: candidate,
    userId,
    accessMode,
    descriptor,
    initialMessages,
    persist,
    onDocumentUpdate,
    onDocumentUpdateDebounceMs,
  } = opts

  conn.binaryType = 'arraybuffer'

  if (
    !(candidate instanceof WSSharedDoc) ||
    docs.get(candidate.name) !== candidate ||
    !candidate.seeded ||
    candidate.isDraining
  ) {
    throw new YjsDocumentDrainingError()
  }
  const doc = candidate
  if (doc.retentionTimer) clearTimeout(doc.retentionTimer)
  doc.retentionTimer = null
  doc.retainUntil = null
  if (onDocumentUpdate && !doc.onDocumentUpdate) {
    doc.onDocumentUpdate = onDocumentUpdate
    doc.onDocumentUpdateDebounceMs = onDocumentUpdateDebounceMs ?? 0
  }
  doc.conns.set(conn, { awarenessIds: new Set(), userId, accessMode, descriptor, persist })

  conn.on('message', (data: ArrayBuffer) => {
    handleMessage(conn, doc, new Uint8Array(data))
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
          void reconcileDocument(doc).catch((error) => {
            console.error('[yjs upstream-utils] Failed to reconcile live document', error)
          })
          void reconcileConnection(doc, conn, connection).catch((error) => {
            console.error('[yjs upstream-utils] Failed to revalidate connection access', error)
          })
        }
      } catch {
        closeConn(doc, conn)
        clearInterval(pingInterval)
      }
    }
  }, PING_TIMEOUT)

  const cleanupConnection = () => {
    closeConn(doc, conn)
    clearInterval(pingInterval)
  }

  conn.on('close', cleanupConnection)
  conn.on('error', cleanupConnection)

  conn.on('pong', () => {
    pongReceived = true
  })

  send(doc, conn, encodeYjsDurableCheckpoint(doc.guid, doc.persistedSnapshot))

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

  initialMessages?.forEach((message) => handleMessage(conn, doc, message))
}

export async function discardDocument(candidate: Y.Doc): Promise<void> {
  if (!(candidate instanceof WSSharedDoc)) return
  const doc = candidate
  if (docs.get(doc.name) !== doc) return

  doc.isDraining = true
  for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn)

  try {
    await doc.mutationQueue
    await flushDocumentPersistence(doc)
  } catch (error) {
    if (docs.get(doc.name) === doc && doc.hasUnsavedChanges) {
      doc.isDraining = false
      schedulePersistenceRetry(doc)
    }
    throw error
  }

  if (docs.get(doc.name) === doc) cleanupDocument(doc)
}

export async function drainYjsSessionTargets(target: YjsRevocationTarget): Promise<void> {
  const normalized = normalizeYjsRevocationTarget(target)
  const sessionIds = new Set(normalized.sessionIds)
  const workspaceIds = new Set(normalized.workspaceIds)
  const targetDocuments = Array.from(docs.values()).filter(
    (doc) => sessionIds.has(doc.name) || (!!doc.workspaceId && workspaceIds.has(doc.workspaceId))
  )
  await Promise.all(targetDocuments.map(discardDocument))
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
  if (!access.hasAccess && doc.conns.get(conn) === connection) {
    closeConn(doc, conn, YJS_CLOSE_CODE_AUTHORIZATION_REVOKED, 'Authorization revoked')
  }
}

export function cleanupAllDocuments(): void {
  for (const doc of Array.from(docs.values())) {
    for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn)
    cleanupDocument(doc)
  }
  isDrainingAllDocuments = false
  terminalPersistenceError = null
}

export async function drainAllDocuments(): Promise<void> {
  isDrainingAllDocuments = true
  const activeDocuments = Array.from(docs.values())
  for (const doc of activeDocuments) doc.isDraining = true

  const persistenceResults = await Promise.allSettled(
    activeDocuments.map(async (doc) => {
      await doc.mutationQueue
      if (docs.get(doc.name) !== doc) return
      await flushDocumentPersistence(doc)
    })
  )

  const retryableFailure = persistenceResults.find(
    (result) =>
      result.status === 'rejected' &&
      (result.reason as { retryable?: unknown })?.retryable !== false
  )
  if (retryableFailure?.status === 'rejected') throw retryableFailure.reason

  for (const doc of activeDocuments) {
    if (docs.get(doc.name) !== doc) continue
    for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn)
    if (docs.get(doc.name) === doc) cleanupDocument(doc)
  }

  if (terminalPersistenceError) throw terminalPersistenceError
}
