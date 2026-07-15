/**
 * Local adaptation of the upstream y-websocket server `src/utils.js` contract.
 *
 * Uses the app's single Yjs runtime and exposes only the helpers this repo
 * needs: `getDocument`, `peekDocument`, `setupWSConnection`,
 * `discardDocument`, and `cleanupAllDocuments`.
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
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'

const messageSync = 0
const messageAwareness = 1

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1

const PING_TIMEOUT = 30_000
const DELETION_LEASE_TTL_MS = 5 * 60_000

const docs = new Map<string, WSSharedDoc>()
const deletionAdmissions = new Map<string, string | null>()
type DeletionLease = {
  targets: string[]
  drain: Promise<void>
  expiryTimer: ReturnType<typeof setTimeout> | null
}
const deletionLeases = new Map<string, DeletionLease>()
let isDrainingAllDocuments = false
let terminalPersistenceError: Error | null = null
type DocumentPersistenceHandler = (docId: string, doc: Y.Doc) => Promise<void> | void
export type DocumentReconciler = () => Promise<void> | void
export type DocumentValidator = (doc: Y.Doc) => void
type ConnectionState = {
  awarenessIds: Set<number>
  userId: string
  accessMode: ReviewAccessMode
  descriptor: ReviewTargetDescriptor
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
  reconciliationInFlight: Promise<void> | null = null
  reconciliationFollowUp: Promise<void> | null = null
  lastReconciliationAt = 0
  isDraining = false
  persistTimer: ReturnType<typeof setTimeout> | null = null
  cleanupRequested = false

  constructor(name: string, gc: boolean, workspaceId: string | null) {
    super({ gc })
    this.name = name
    this.workspaceId = workspaceId
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
    !doc.hasUnsavedChanges &&
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

function cleanupDrainingDocumentIfSettled(doc: WSSharedDoc): void {
  if (doc.isDraining && doc.cleanupRequested && doc.conns.size === 0 && isDocumentIdle(doc)) {
    cleanupDocument(doc)
  }
}

function enqueueDocumentPersistence(
  doc: WSSharedDoc,
  persist: DocumentPersistenceHandler | undefined
): Promise<void> {
  if (!persist) return doc.persistenceQueue

  const requestedGeneration = doc.changeGeneration
  doc.pendingPersistRequests += 1
  const run = doc.persistenceQueue.then(async () => {
    if (!doc.hasUnsavedChanges) return
    doc.isPersisting = true
    try {
      await persist(doc.name, doc)
      const hasNewerChanges = doc.changeGeneration !== requestedGeneration
      doc.hasUnsavedChanges = hasNewerChanges
    } catch (error) {
      if ((error as { retryable?: unknown } | null)?.retryable !== false) {
        doc.hasUnsavedChanges = true
      } else {
        terminalPersistenceError ??= error as Error
        doc.hasUnsavedChanges = false
        doc.isDraining = true
        doc.cleanupRequested = true
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
    cleanupDrainingDocumentIfSettled(doc)
    if (!doc.isDraining && doc.cleanupRequested && doc.conns.size === 0 && isDocumentIdle(doc)) {
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
  doc.cleanupRequested = true
  if (doc.isDraining) return

  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }

  if (doc.pendingMutations > 0) return
  if (isDocumentIdle(doc)) {
    cleanupDocument(doc)
    return
  }

  const persist = doc.onDocumentUpdate
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

function closeConn(doc: WSSharedDoc, conn: WebSocket, code?: number, reason?: string): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn)?.awarenessIds ?? new Set<number>()
    doc.conns.delete(conn)
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null)

    if (doc.conns.size === 0) {
      finalizeDocumentCleanup(doc)
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

export function getDocument(
  docId: string,
  gc = true,
  bootstrapState?: Uint8Array,
  workspaceId?: string | null
): { doc: Y.Doc; created: boolean } {
  if (isYjsSessionAdmissionBlocked(docId, workspaceId)) throw new YjsSessionAdmissionError(docId)
  const existing = docs.get(docId)
  if (existing) return { doc: existing, created: false }

  const doc = new WSSharedDoc(docId, gc, workspaceId ?? null)
  if (bootstrapState) {
    Y.applyUpdate(doc, bootstrapState, YJS_ORIGINS.SYSTEM)
    doc.hasUnsavedChanges = false
  }
  docs.set(docId, doc)
  return { doc, created: true }
}

export function markDocumentPersisted(doc: Y.Doc): void {
  if (doc instanceof WSSharedDoc) {
    doc.hasUnsavedChanges = false
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
    cleanupDrainingDocumentIfSettled(doc)
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
  if (doc.reconciliationFollowUp) return doc.reconciliationFollowUp
  if (doc.reconciliationInFlight) {
    if (!force) return doc.reconciliationInFlight
    doc.reconciliationFollowUp = doc.reconciliationInFlight
      .catch(() => undefined)
      .then(() => {
        doc.reconciliationFollowUp = null
        return reconcileDocument(doc, true)
      })
    return doc.reconciliationFollowUp
  }
  if (
    !doc.onDocumentReconcile ||
    (!force && Date.now() - doc.lastReconciliationAt < PING_TIMEOUT)
  ) {
    return Promise.resolve()
  }

  doc.lastReconciliationAt = Date.now()
  const reconciliation = runDocumentMutation(doc, doc.onDocumentReconcile)
  doc.reconciliationInFlight = reconciliation
  return reconciliation.finally(() => {
    if (doc.reconciliationInFlight === reconciliation) doc.reconciliationInFlight = null
  })
}

export async function flushDocumentPersistence(doc: Y.Doc): Promise<void> {
  if (!(doc instanceof WSSharedDoc)) return
  if (doc.persistTimer) {
    clearTimeout(doc.persistTimer)
    doc.persistTimer = null
  }
  await enqueueDocumentPersistence(doc, doc.onDocumentUpdate)
}

export function peekDocument(docId: string): Y.Doc | null {
  return docs.get(docId) ?? null
}

export function isYjsSessionAdmissionBlocked(docId: string, workspaceId?: string | null): boolean {
  const resolvedWorkspaceId = workspaceId ?? docs.get(docId)?.workspaceId
  return (
    isDrainingAllDocuments ||
    deletionAdmissions.has(`session:${docId}`) ||
    (!!resolvedWorkspaceId && deletionAdmissions.has(`workspace:${resolvedWorkspaceId}`)) ||
    docs.get(docId)?.isDraining === true
  )
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
    onDocumentUpdate?: DocumentPersistenceHandler
    onDocumentUpdateDebounceMs?: number
    validateDocument?: DocumentValidator
  }
): void {
  const {
    docId,
    userId,
    accessMode,
    descriptor,
    gc = true,
    bootstrapState,
    onDocumentUpdate,
    onDocumentUpdateDebounceMs,
    validateDocument,
  } = opts

  conn.binaryType = 'arraybuffer'

  const doc = getDocument(docId, gc, bootstrapState, descriptor.workspaceId).doc as WSSharedDoc
  if (onDocumentUpdate && !doc.onDocumentUpdate) {
    doc.onDocumentUpdate = onDocumentUpdate
    doc.onDocumentUpdateDebounceMs = onDocumentUpdateDebounceMs ?? 0
  }
  if (validateDocument && !doc.validateDocument) doc.validateDocument = validateDocument
  doc.conns.set(conn, { awarenessIds: new Set(), userId, accessMode, descriptor })

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

  conn.on('close', () => {
    closeConn(doc, conn)
    clearInterval(pingInterval)
  })

  conn.on('pong', () => {
    pongReceived = true
  })

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
  lease.expiryTimer = setTimeout(() => {
    if (deletionLeases.get(leaseId) === lease) abortYjsSessionDeletion(leaseId)
  }, DELETION_LEASE_TTL_MS)
}

function removeYjsSessionDeletionLease(leaseId: string): DeletionLease | undefined {
  const lease = deletionLeases.get(leaseId)
  if (!lease) return undefined
  deletionLeases.delete(leaseId)
  if (lease.expiryTimer) clearTimeout(lease.expiryTimer)
  lease.expiryTimer = null
  return lease
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
    lease = { targets, drain, expiryTimer: null }
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

export function commitYjsSessionDeletion(leaseId: string): void {
  const lease = removeYjsSessionDeletionLease(leaseId)
  if (!lease) return
  for (const deletionTarget of lease.targets) {
    if (deletionAdmissions.get(deletionTarget) === leaseId)
      deletionAdmissions.set(deletionTarget, null)
  }
}

export function abortYjsSessionDeletion(leaseId: string): void {
  const lease = removeYjsSessionDeletionLease(leaseId)
  if (!lease) return
  for (const deletionTarget of lease.targets) {
    if (deletionAdmissions.get(deletionTarget) === leaseId)
      deletionAdmissions.delete(deletionTarget)
  }
}

export function discardDocumentIfIdle(candidate: Y.Doc): void {
  if (!(candidate instanceof WSSharedDoc)) return
  const doc = candidate
  if (docs.get(doc.name) !== doc || doc.conns.size > 0) return
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
  if (!access.hasAccess && doc.conns.get(conn) === connection) {
    closeConn(doc, conn, YJS_CLOSE_CODE_AUTHORIZATION_REVOKED, 'Authorization revoked')
  }
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
      if (doc.persistTimer) {
        clearTimeout(doc.persistTimer)
        doc.persistTimer = null
      }
      const persist = doc.onDocumentUpdate
      if (doc.hasUnsavedChanges && persist) await enqueueDocumentPersistence(doc, persist)
      await doc.persistenceQueue
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
