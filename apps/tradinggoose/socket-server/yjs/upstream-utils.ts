/**
 * Local adaptation of the upstream y-websocket server `src/utils.js` contract.
 *
 * Uses the app's single Yjs runtime and exposes only the helpers this repo
 * needs: `acquireDocument`, `peekDocument`, `setupWSConnection`,
 * `discardDocument` and `cleanupAllDocuments`.
 */

import { randomUUID } from 'node:crypto'
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
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000
const DELETION_LEASE_TTL_MS = 5 * 60_000
const DOCUMENT_RETENTION_MS = 5 * 60_000

const docs = new Map<string, WSSharedDoc>()
const deletionAdmissions = new Map<string, string>()
type DeletionLease = {
  targets: string[]
  drain: Promise<void>
  expiryTimer: ReturnType<typeof setTimeout> | null
  heldLocally: boolean
}
const deletionLeases = new Map<string, DeletionLease>()
let isDrainingAllDocuments = false
let terminalPersistenceError: Error | null = null
type DocumentPersistenceHandler = (docId: string, doc: Y.Doc) => Promise<void> | void
type DocumentInitialization = { state?: Uint8Array; workspaceId?: string | null }
type DocumentInitializer = (
  doc: Y.Doc
) => Promise<DocumentInitialization | undefined> | DocumentInitialization | undefined
export type DocumentReconciler = () => Promise<void> | void
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

export class YjsSessionAdmissionError extends Error {
  readonly status = 409

  constructor(sessionId: string) {
    super(`Yjs session ${sessionId} is not accepting connections`)
    this.name = 'YjsSessionAdmissionError'
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
    const persistedSnapshot = Y.snapshot(doc)
    doc.isPersisting = true
    try {
      await persist(doc.name, doc)
      publishPersistedSnapshot(doc, persistedSnapshot)
      const hasNewerChanges = doc.changeGeneration !== requestedGeneration
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
    initialize: DocumentInitializer
  },
  use: (doc: Y.Doc) => Promise<T> | T
): Promise<T> {
  assertYjsSessionAdmission(docId, options.workspaceId)
  let doc = docs.get(docId)
  if (!doc) {
    doc = new WSSharedDoc(docId, options.gc ?? true, options.workspaceId ?? null, false)
    docs.set(docId, doc)
  }
  return runDocumentMutation(doc, async () => {
    const shared = doc as WSSharedDoc
    if (!shared.seeded) {
      const resolved = await options.initialize(doc)
      if (resolved?.workspaceId !== undefined) shared.workspaceId = resolved.workspaceId
      assertYjsSessionAdmission(shared.name, shared.workspaceId)
      if (resolved?.state) Y.applyUpdate(doc, resolved.state, YJS_ORIGINS.SYSTEM)
      shared.seeded = true
      shared.hasUnsavedChanges = false
      shared.persistedSnapshot = Y.snapshot(shared)
    }
    return use(doc)
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
    const result = await persist(staging)
    targets.forEach(({ doc }, index) => {
      Y.applyUpdate(
        doc,
        Y.encodeStateAsUpdate(staging[index]!, liveStates[index]),
        YJS_ORIGINS.SYSTEM
      )
      if (!(doc instanceof WSSharedDoc)) return
      publishPersistedSnapshot(doc, Y.snapshot(staging[index]!), requestId)
      if (doc.changeGeneration === generations[index]) doc.hasUnsavedChanges = false
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

export function assertYjsSessionAdmission(docId: string, workspaceId?: string | null): void {
  const resolvedWorkspaceId = workspaceId ?? docs.get(docId)?.workspaceId
  const sessionTarget = `session:${docId}`
  const workspaceTarget = resolvedWorkspaceId ? `workspace:${resolvedWorkspaceId}` : null
  const blocked =
    isDrainingAllDocuments ||
    deletionAdmissions.has(sessionTarget) ||
    (workspaceTarget !== null && deletionAdmissions.has(workspaceTarget)) ||
    docs.get(docId)?.isDraining === true
  if (!blocked) return
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
    persist?: (doc: Y.Doc, requestId: string, identityName?: string) => Promise<void>
    onDocumentUpdate?: DocumentPersistenceHandler
    onDocumentUpdateDebounceMs?: number
    validateDocument?: DocumentValidator
  }
): void {
  const {
    doc: candidate,
    userId,
    accessMode,
    descriptor,
    persist,
    onDocumentUpdate,
    onDocumentUpdateDebounceMs,
    validateDocument,
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
  if (validateDocument && !doc.validateDocument) doc.validateDocument = validateDocument
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

function refreshYjsSessionDeletionLease(leaseId: string, lease: DeletionLease): void {
  if (lease.expiryTimer) clearTimeout(lease.expiryTimer)
  if (lease.heldLocally) {
    lease.expiryTimer = null
    return
  }
  lease.expiryTimer = setTimeout(() => {
    if (deletionLeases.get(leaseId) !== lease) return
    releaseYjsSessionDeletionLease(leaseId)
  }, DELETION_LEASE_TTL_MS)
}

function releaseYjsSessionDeletionLease(leaseId: string): void {
  const lease = deletionLeases.get(leaseId)
  if (!lease) return
  deletionLeases.delete(leaseId)
  if (lease.expiryTimer) clearTimeout(lease.expiryTimer)
  for (const target of lease.targets) {
    if (deletionAdmissions.get(target) === leaseId) deletionAdmissions.delete(target)
  }
}

function normalizeDeletionTargetIds(ids: readonly string[] = []): string[] {
  return [...new Set(ids)].sort()
}

export async function beginYjsSessionDeletion(
  leaseId: string,
  target: { sessionIds?: readonly string[]; workspaceIds?: readonly string[] }
): Promise<void> {
  if (!leaseId.trim()) throw new Error('A non-empty Yjs deletion lease ID is required')
  const orderedSessionIds = normalizeDeletionTargetIds(target.sessionIds)
  const orderedWorkspaceIds = normalizeDeletionTargetIds(target.workspaceIds)
  if (
    orderedSessionIds.length + orderedWorkspaceIds.length === 0 ||
    [...orderedSessionIds, ...orderedWorkspaceIds].some((id) => !id.trim())
  ) {
    throw new Error('At least one non-empty Yjs deletion target is required')
  }
  const targets = [
    ...orderedSessionIds.map((id) => `session:${id}`),
    ...orderedWorkspaceIds.map((id) => `workspace:${id}`),
  ]
  const firstTarget = targets[0]!
  let lease = deletionLeases.get(leaseId)
  if (lease) {
    if (JSON.stringify(lease.targets) !== JSON.stringify(targets)) {
      throw new YjsSessionAdmissionError(firstTarget)
    }
  } else {
    const sessionTargets = new Set(orderedSessionIds)
    const workspaceTargets = new Set(orderedWorkspaceIds)
    const targetDocuments = Array.from(docs.values()).filter(
      (doc) =>
        sessionTargets.has(doc.name) || (!!doc.workspaceId && workspaceTargets.has(doc.workspaceId))
    )
    if (
      isDrainingAllDocuments ||
      targets.some((deletionTarget) => deletionAdmissions.has(deletionTarget)) ||
      targetDocuments.some((doc) => doc.isDraining)
    ) {
      throw new YjsSessionAdmissionError(firstTarget)
    }

    for (const deletionTarget of targets) deletionAdmissions.set(deletionTarget, leaseId)
    const drain = Promise.all(targetDocuments.map(discardDocument)).then(() => undefined)
    lease = { targets, drain, expiryTimer: null, heldLocally: false }
    deletionLeases.set(leaseId, lease)
  }
  refreshYjsSessionDeletionLease(leaseId, lease)

  try {
    await lease.drain
    if (deletionLeases.get(leaseId) !== lease) {
      throw new YjsSessionAdmissionError(firstTarget)
    }
    refreshYjsSessionDeletionLease(leaseId, lease)
  } catch (error) {
    if (deletionLeases.get(leaseId) === lease) abortYjsSessionDeletion(leaseId)
    throw error
  }
}

export async function withYjsSessionDeletion<T>(
  target: { sessionIds?: readonly string[]; workspaceIds?: readonly string[] },
  mutate: () => Promise<T>
): Promise<T> {
  const leaseId = randomUUID()
  await beginYjsSessionDeletion(leaseId, target)
  const lease = deletionLeases.get(leaseId)
  if (!lease) throw new YjsSessionAdmissionError(leaseId)
  lease.heldLocally = true
  refreshYjsSessionDeletionLease(leaseId, lease)

  try {
    const result = await mutate()
    commitYjsSessionDeletion(leaseId)
    return result
  } catch (error) {
    abortYjsSessionDeletion(leaseId)
    throw error
  }
}

export function commitYjsSessionDeletion(leaseId: string): void {
  releaseYjsSessionDeletionLease(leaseId)
}

export function abortYjsSessionDeletion(leaseId: string): void {
  releaseYjsSessionDeletionLease(leaseId)
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

export async function reconcileWorkspaceConnections(
  workspaceId: string,
  payload?: unknown
): Promise<void> {
  const candidate =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null
  const selectedUserIds = Array.isArray(candidate?.userIds)
    ? new Set(
        candidate.userIds.filter(
          (value): value is string => typeof value === 'string' && value.length > 0
        )
      )
    : null
  const checks: Promise<void>[] = []
  for (const doc of docs.values()) {
    for (const [conn, connection] of doc.conns) {
      if (connection.descriptor.workspaceId !== workspaceId) continue
      if (selectedUserIds?.size && !selectedUserIds.has(connection.userId)) continue

      checks.push(reconcileConnection(doc, conn, connection))
    }
  }
  const results = await Promise.allSettled(checks)
  for (const result of results) if (result.status === 'rejected') throw result.reason
}

export function cleanupAllDocuments(): void {
  for (const doc of Array.from(docs.values())) {
    for (const conn of Array.from(doc.conns.keys())) closeConn(doc, conn)
    cleanupDocument(doc)
  }
  for (const lease of deletionLeases.values()) {
    if (lease.expiryTimer) clearTimeout(lease.expiryTimer)
  }
  deletionLeases.clear()
  deletionAdmissions.clear()
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
