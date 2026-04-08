import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import { env } from '@/lib/env'
import {
  buildReviewTargetDescriptorFromEnvelope,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getRedisClient, getRedisStorageMode } from '@/lib/redis'
import { getRuntimeStateFromDoc, getRuntimeStateFromUpdate } from '@/lib/yjs/server/bootstrap-review-target'
import {
  getMetadataMap as getWorkflowMetadataMap,
  setVariables,
  setWorkflowState,
  type WorkflowSnapshot,
} from '@/lib/yjs/workflow-session'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { deleteSession, getState, storeState } from '@/socket-server/yjs/persistence'
import { getExistingDocument, removeDocument } from '@/socket-server/yjs/upstream-utils'

interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
}

type MonitorRuntimeStatus = 'not_initialized' | 'running' | 'degraded' | 'disabled'

type MonitorRuntimeHealth = {
  enabled: boolean
  status: MonitorRuntimeStatus
  reconcileEndpointEnabled: boolean
  lock: {
    mode: 'fail_closed'
    redisConfigured: boolean
    redisClientAvailable: boolean
    degraded: boolean
  }
}

type HttpHandlerOptions = {
  getMonitorRuntimeHealth?: () => MonitorRuntimeHealth
  getConnectionCount?: () => number
  onIndicatorMonitorsReconcile?: () => Promise<void> | void
}

const INTERNAL_SECRET_HEADER = 'x-internal-secret'
const INTERNAL_YJS_WORKFLOW_APPLY_PATH = /^\/internal\/yjs\/workflows\/([^/]+)\/apply-state$/
const INTERNAL_YJS_SNAPSHOT_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/snapshot$/
const INTERNAL_YJS_SESSION_CLEAR_RESEEDED_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/clear-reseeded$/
const INTERNAL_YJS_SESSION_PATH = /^\/internal\/yjs\/sessions\/([^/]+)$/

type ApplyWorkflowStateRequest = {
  workflowState: WorkflowSnapshot
  variables?: Record<string, any>
}

class InvalidInternalYjsRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidInternalYjsRequestError'
  }
}

function isInternalRequestAuthorized(req: IncomingMessage): boolean {
  const providedHeader = req.headers[INTERNAL_SECRET_HEADER]
  const expectedSecret = env.INTERNAL_API_SECRET

  if (!expectedSecret) {
    return false
  }

  if (Array.isArray(providedHeader)) {
    return providedHeader.includes(expectedSecret)
  }

  return typeof providedHeader === 'string' && providedHeader === expectedSecret
}

function rejectUnauthorizedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger
): boolean {
  if (isInternalRequestAuthorized(req)) {
    return false
  }

  logger.warn('Denied unauthorized internal socket endpoint request', {
    path: req.url,
    method: req.method,
  })
  res.writeHead(401, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Unauthorized' }))
  return true
}

function getDefaultMonitorRuntimeHealth(): MonitorRuntimeHealth {
  const redisConfigured = getRedisStorageMode() === 'redis'
  const redisClientAvailable = Boolean(getRedisClient())
  const degraded = redisConfigured && !redisClientAvailable

  return {
    enabled: false,
    status: degraded ? 'degraded' : 'not_initialized',
    reconcileEndpointEnabled: true,
    lock: {
      mode: 'fail_closed',
      redisConfigured,
      redisClientAvailable,
      degraded,
    },
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) {
    throw new InvalidInternalYjsRequestError('Request body is required')
  }

  try {
    return JSON.parse(raw)
  } catch {
    throw new InvalidInternalYjsRequestError('Invalid JSON body')
  }
}

function parseApplyWorkflowStateRequest(body: unknown): ApplyWorkflowStateRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidInternalYjsRequestError('Invalid apply workflow state body')
  }

  const candidate = body as Record<string, unknown>
  if (
    !candidate.workflowState ||
    typeof candidate.workflowState !== 'object' ||
    Array.isArray(candidate.workflowState)
  ) {
    throw new InvalidInternalYjsRequestError('workflowState is required')
  }

  if (
    candidate.variables !== undefined &&
    (!candidate.variables ||
      typeof candidate.variables !== 'object' ||
      Array.isArray(candidate.variables))
  ) {
    throw new InvalidInternalYjsRequestError('variables must be an object')
  }

  return {
    workflowState: candidate.workflowState as WorkflowSnapshot,
    variables: candidate.variables as Record<string, any> | undefined,
  }
}

function replaceWorkflowDocState(
  doc: Y.Doc,
  workflowState: WorkflowSnapshot,
  variables?: Record<string, any>
): void {
  setWorkflowState(doc, workflowState, YJS_ORIGINS.SYSTEM)

  if (variables !== undefined) {
    setVariables(doc, variables, YJS_ORIGINS.SYSTEM)
  }

  doc.transact(() => {
    getWorkflowMetadataMap(doc).delete('reseededFromCanonical')
  }, YJS_ORIGINS.SYSTEM)
}

function clearSessionReseededFromCanonical(doc: Y.Doc): void {
  doc.transact(() => {
    doc.getMap('metadata').delete('reseededFromCanonical')
  }, YJS_ORIGINS.SAVE)
}

async function handleInternalYjsWorkflowApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  workflowId: string
): Promise<void> {
  try {
    const body = parseApplyWorkflowStateRequest(await readJsonBody(req))
    const liveDoc = await getExistingDocument(workflowId)
    const doc = liveDoc ?? new Y.Doc()

    try {
      replaceWorkflowDocState(doc, body.workflowState, body.variables)
      await storeState(workflowId, Y.encodeStateAsUpdate(doc))
    } finally {
      if (!liveDoc) doc.destroy()
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
  } catch (error) {
    logger.error('Error applying workflow state', { error, workflowId })
    const status = error instanceof InvalidInternalYjsRequestError ? 400 : 500
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to apply workflow state',
      })
    )
  }
}

async function handleInternalYjsSessionDeleteRequest(
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    removeDocument(sessionId)
    await deleteSession(sessionId)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true }))
  } catch (error) {
    logger.error('Error deleting Yjs session', { error, sessionId })
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Failed to delete Yjs session' }))
  }
}

async function handleInternalYjsSessionClearReseededRequest(
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    const liveDoc = await getExistingDocument(sessionId)
    if (liveDoc) {
      clearSessionReseededFromCanonical(liveDoc)
      await storeState(sessionId, Y.encodeStateAsUpdate(liveDoc))

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, updated: true }))
      return
    }

    const state = await getState(sessionId)
    if (!state) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, updated: false }))
      return
    }

    const doc = new Y.Doc()

    try {
      Y.applyUpdate(doc, state)
      clearSessionReseededFromCanonical(doc)
      await storeState(sessionId, Y.encodeStateAsUpdate(doc))
    } finally {
      doc.destroy()
    }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: true, updated: true }))
  } catch (error) {
    logger.error('Error clearing reseeded flag from Yjs session', { error, sessionId })
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Failed to clear reseeded flag' }))
  }
}

async function getLiveOrPersistedYjsState(
  sessionId: string
): Promise<{ liveDoc: Y.Doc | null; state: Uint8Array | null }> {
  const liveDoc = await getExistingDocument(sessionId)
  if (liveDoc) {
    return {
      liveDoc,
      state: Y.encodeStateAsUpdate(liveDoc),
    }
  }

  return {
    liveDoc: null,
    state: await getState(sessionId),
  }
}

async function handleInternalYjsSnapshotRequest(
  parsedUrl: URL,
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      res.writeHead(409, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session ID mismatch', sessionId }))
      return
    }

    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    const { liveDoc, state } = await getLiveOrPersistedYjsState(sessionId)

    if (!state) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Session not found', sessionId }))
      return
    }

    const runtime = liveDoc ? getRuntimeStateFromDoc(liveDoc) : getRuntimeStateFromUpdate(state)

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        snapshotBase64: Buffer.from(state).toString('base64'),
        descriptor,
        runtime,
      })
    )
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Failed to get snapshot' }))
  }
}

function matchInternalRoute(pathname: string, pattern: RegExp, method: string, reqMethod?: string): string | null {
  if (reqMethod !== method) return null
  const match = pathname.match(pattern)?.[1]
  return match ? decodeURIComponent(match) : null
}

async function handleInternalYjsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  parsedUrl: URL
): Promise<boolean> {
  const applyId = matchInternalRoute(parsedUrl.pathname, INTERNAL_YJS_WORKFLOW_APPLY_PATH, 'POST', req.method)
  if (applyId) {
    await handleInternalYjsWorkflowApplyRequest(req, res, logger, applyId)
    return true
  }

  const snapshotId = matchInternalRoute(parsedUrl.pathname, INTERNAL_YJS_SNAPSHOT_PATH, 'GET', req.method)
  if (snapshotId) {
    await handleInternalYjsSnapshotRequest(parsedUrl, res, logger, snapshotId)
    return true
  }

  const clearReseededId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_SESSION_CLEAR_RESEEDED_PATH,
    'POST',
    req.method
  )
  if (clearReseededId) {
    await handleInternalYjsSessionClearReseededRequest(res, logger, clearReseededId)
    return true
  }

  const deleteId = matchInternalRoute(parsedUrl.pathname, INTERNAL_YJS_SESSION_PATH, 'DELETE', req.method)
  if (deleteId) {
    await handleInternalYjsSessionDeleteRequest(res, logger, deleteId)
    return true
  }

  return false
}

export function createHttpHandler(
  logger: Logger,
  options?: HttpHandlerOptions
) {
  const resolveMonitorRuntimeHealth =
    options?.getMonitorRuntimeHealth ?? getDefaultMonitorRuntimeHealth
  const resolveConnectionCount = options?.getConnectionCount ?? (() => 0)
  const triggerIndicatorMonitorsReconcile = options?.onIndicatorMonitorsReconcile

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (res.writableEnded || res.headersSent) {
      return
    }

    if (req.url?.startsWith('/socket.io')) {
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          timestamp: new Date().toISOString(),
          connections: resolveConnectionCount(),
          monitorRuntime: resolveMonitorRuntimeHealth(),
        })
      )
      return
    }

    if (req.method === 'POST' && req.url === '/internal/indicator-monitors/reconcile') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      try {
        await triggerIndicatorMonitorsReconcile?.()
        logger.info('Accepted indicator monitor reconcile request')
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true }))
      } catch (error) {
        logger.error('Failed to process indicator monitor reconcile request', { error })
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Failed to process reconcile request' }))
      }
      return
    }

    if (req.url) {
      const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
      if (parsedUrl.pathname.startsWith('/internal/yjs/')) {
        if (rejectUnauthorizedRequest(req, res, logger)) return
        if (await handleInternalYjsRequest(req, res, logger, parsedUrl)) {
          return
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }
}
