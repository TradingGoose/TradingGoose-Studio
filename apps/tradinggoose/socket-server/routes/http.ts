import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import {
  buildReviewTargetDescriptorFromEnvelope,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { env } from '@/lib/env'
import { seedEntitySession } from '@/lib/yjs/entity-session'
import {
  bootstrapReviewTarget,
  getRuntimeStateFromDoc,
  getRuntimeStateFromUpdate,
} from '@/lib/yjs/server/bootstrap-review-target'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { replaceWorkflowDocumentState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { getMonitorRuntimeLockHealth } from '@/socket-server/monitor-runtime-lock'
import {
  getLastTouchedAt,
  getState,
  storeState,
} from '@/socket-server/yjs/persistence'
import {
  flushDocumentPersistence,
  getDocument,
  getExistingDocument,
  setPersistence,
} from '@/socket-server/yjs/upstream-utils'

interface Logger {
  info: (message: string, ...args: any[]) => void
  error: (message: string, ...args: any[]) => void
  debug: (message: string, ...args: any[]) => void
  warn: (message: string, ...args: any[]) => void
}

type MonitorRuntimeHealth = Record<string, unknown>

type HttpHandlerOptions = {
  getMonitorRuntimeHealth?: () => MonitorRuntimeHealth
  getConnectionCount?: () => number
  onMonitorsReconcile?: () => Promise<void> | void
}

const INTERNAL_SECRET_HEADER = 'x-internal-secret'
const INTERNAL_YJS_WORKFLOW_APPLY_PATH = /^\/internal\/yjs\/workflows\/([^/]+)\/apply-state$/
const INTERNAL_YJS_ENTITY_APPLY_PATH = /^\/internal\/yjs\/entities\/([^/]+)\/apply-state$/
const INTERNAL_YJS_SNAPSHOT_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/snapshot$/
const INTERNAL_YJS_SESSION_APPLY_UPDATE_PATH =
  /^\/internal\/yjs\/sessions\/([^/]+)\/apply-update$/

type ApplyWorkflowStateRequest = {
  workflowState: WorkflowSnapshot
  variables?: Record<string, any>
  entityName?: string
}

type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow'>

type ApplyEntityStateRequest = {
  entityKind: SavedEntityKind
  fields: Record<string, any>
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

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
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
  sendJson(res, 401, { error: 'Unauthorized' })
  return true
}

function getDefaultMonitorRuntimeHealth(): MonitorRuntimeHealth {
  const defaultStatus = getMonitorRuntimeLockHealth('not_initialized').degraded
    ? 'degraded'
    : 'not_initialized'
  const lock = getMonitorRuntimeLockHealth(defaultStatus)

  return {
    indicator: {
      enabled: false,
      status: defaultStatus,
      lock,
      stats: {
        activeSubscriptions: 0,
        lastReconcileAt: null,
        lastReconcileError: null,
        dispatchedCount: 0,
        skippedCount: 0,
      },
    },
    portfolio: {
      enabled: false,
      status: defaultStatus,
      lock,
      stats: {
        activeSubscriptions: 0,
        lastReconcileAt: null,
        lastReconcileError: null,
      },
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
    entityName: typeof candidate.entityName === 'string' ? candidate.entityName.trim() : undefined,
  }
}

function parseApplyEntityStateRequest(body: unknown): ApplyEntityStateRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidInternalYjsRequestError('Invalid apply entity state body')
  }

  const candidate = body as Record<string, unknown>
  if (
    candidate.entityKind !== 'skill' &&
    candidate.entityKind !== 'custom_tool' &&
    candidate.entityKind !== 'indicator' &&
    candidate.entityKind !== 'knowledge_base' &&
    candidate.entityKind !== 'mcp_server'
  ) {
    throw new InvalidInternalYjsRequestError('Invalid entityKind')
  }

  if (
    !candidate.fields ||
    typeof candidate.fields !== 'object' ||
    Array.isArray(candidate.fields)
  ) {
    throw new InvalidInternalYjsRequestError('fields are required')
  }

  return {
    entityKind: candidate.entityKind,
    fields: candidate.fields as Record<string, any>,
  }
}

function clearSessionReseededFromCanonical(doc: Y.Doc): void {
  doc.transact(() => {
    doc.getMap('metadata').delete('reseededFromCanonical')
  }, YJS_ORIGINS.SYSTEM)
}

async function getInitializedSessionDocument(sessionId: string): Promise<Y.Doc> {
  setPersistence(sessionId, { getState, storeState })
  const doc = getDocument(sessionId) as Y.Doc & { whenInitialized?: Promise<void> }
  await doc.whenInitialized
  return doc
}

async function getBootstrappedApplyDocument(
  descriptor: ReturnType<typeof buildReviewTargetDescriptorFromEnvelope>
): Promise<Y.Doc> {
  if (!(await getExistingDocument(descriptor.yjsSessionId)) && !(await getState(descriptor.yjsSessionId))) {
    if (!descriptor.entityId) {
      throw new InvalidInternalYjsRequestError('Saved Yjs session required')
    }
    const bootstrapped = await bootstrapReviewTarget(descriptor)
    if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
      throw new Error('Yjs review target is not active')
    }
  }

  return getInitializedSessionDocument(descriptor.yjsSessionId)
}

async function handleInternalYjsWorkflowApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  workflowId: string
): Promise<void> {
  try {
    const body = parseApplyWorkflowStateRequest(await readJsonBody(req))
    const doc = await getBootstrappedApplyDocument({
      workspaceId: null,
      entityKind: 'workflow',
      entityId: workflowId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: workflowId,
    })

    replaceWorkflowDocumentState(doc, body.workflowState, body.variables, body.entityName)
    await flushDocumentPersistence(workflowId)

    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error applying workflow state', { error, workflowId })
    const status = error instanceof InvalidInternalYjsRequestError ? 400 : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply workflow state',
    })
  }
}

async function handleInternalYjsEntityApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  try {
    const body = parseApplyEntityStateRequest(await readJsonBody(req))
    const doc = await getBootstrappedApplyDocument({
      workspaceId: null,
      entityKind: body.entityKind,
      entityId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: entityId,
    })

    seedEntitySession(doc, {
      entityKind: body.entityKind,
      payload: body.fields,
    })
    clearSessionReseededFromCanonical(doc)
    await flushDocumentPersistence(entityId)

    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error applying entity state', { error, entityId })
    const status = error instanceof InvalidInternalYjsRequestError ? 400 : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply entity state',
    })
  }
}

async function handleInternalYjsSessionApplyUpdateRequest(
  req: IncomingMessage,
  parsedUrl: URL,
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      sendJson(res, 409, { error: 'Session ID mismatch', sessionId })
      return
    }

    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    const body = await readJsonBody(req)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new InvalidInternalYjsRequestError('Invalid apply session update body')
    }
    const updateBase64 = (body as Record<string, unknown>).updateBase64
    if (typeof updateBase64 !== 'string' || !updateBase64) {
      throw new InvalidInternalYjsRequestError('updateBase64 is required')
    }
    const doc = await getBootstrappedApplyDocument(descriptor)

    Y.applyUpdate(doc, Buffer.from(updateBase64, 'base64'), YJS_ORIGINS.SAVE)
    clearSessionReseededFromCanonical(doc)
    await flushDocumentPersistence(sessionId)

    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error applying Yjs session update', { error, path: parsedUrl.pathname })
    const status = error instanceof InvalidInternalYjsRequestError ? 400 : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply session update',
    })
  }
}

async function getLiveOrPersistedYjsState(
  sessionId: string
): Promise<{ liveDoc: Y.Doc | null; state: Uint8Array | null; touchedAt: number | null }> {
  const liveDoc = await getExistingDocument(sessionId)
  if (liveDoc) {
    await flushDocumentPersistence(sessionId)
  }

  const state = liveDoc ? Y.encodeStateAsUpdate(liveDoc) : await getState(sessionId)
  return {
    liveDoc,
    state,
    touchedAt: state ? await getLastTouchedAt(sessionId) : null,
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
      sendJson(res, 409, { error: 'Session ID mismatch', sessionId })
      return
    }

    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    const { liveDoc, state, touchedAt } = await getLiveOrPersistedYjsState(sessionId)

    if (!state) {
      sendJson(res, 404, { error: 'Session not found', sessionId })
      return
    }

    const runtime = liveDoc ? getRuntimeStateFromDoc(liveDoc) : getRuntimeStateFromUpdate(state)

    sendJson(res, 200, {
      snapshotBase64: Buffer.from(state).toString('base64'),
      descriptor,
      runtime,
      touchedAt,
    })
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    sendJson(res, 400, { error: 'Failed to get snapshot' })
  }
}

function matchInternalRoute(
  pathname: string,
  pattern: RegExp,
  method: string,
  reqMethod?: string
): string | null {
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
  const applyId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_WORKFLOW_APPLY_PATH,
    'POST',
    req.method
  )
  if (applyId) {
    await handleInternalYjsWorkflowApplyRequest(req, res, logger, applyId)
    return true
  }

  const applyEntityId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_ENTITY_APPLY_PATH,
    'POST',
    req.method
  )
  if (applyEntityId) {
    await handleInternalYjsEntityApplyRequest(req, res, logger, applyEntityId)
    return true
  }

  const snapshotId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_SNAPSHOT_PATH,
    'GET',
    req.method
  )
  if (snapshotId) {
    await handleInternalYjsSnapshotRequest(parsedUrl, res, logger, snapshotId)
    return true
  }

  const applyUpdateId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_SESSION_APPLY_UPDATE_PATH,
    'POST',
    req.method
  )
  if (applyUpdateId) {
    await handleInternalYjsSessionApplyUpdateRequest(req, parsedUrl, res, logger, applyUpdateId)
    return true
  }

  return false
}

export function createHttpHandler(logger: Logger, options?: HttpHandlerOptions) {
  const resolveMonitorRuntimeHealth =
    options?.getMonitorRuntimeHealth ?? getDefaultMonitorRuntimeHealth
  const resolveConnectionCount = options?.getConnectionCount ?? (() => 0)
  const triggerMonitorsReconcile = options?.onMonitorsReconcile

  return async (req: IncomingMessage, res: ServerResponse) => {
    if (res.writableEnded || res.headersSent) {
      return
    }

    if (req.url?.startsWith('/socket.io')) {
      return
    }

    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        status: 'ok',
        timestamp: new Date().toISOString(),
        connections: resolveConnectionCount(),
        monitorRuntime: resolveMonitorRuntimeHealth(),
      })
      return
    }

    if (req.method === 'POST' && req.url === '/internal/monitors/reconcile') {
      if (rejectUnauthorizedRequest(req, res, logger)) return

      try {
        await triggerMonitorsReconcile?.()
        logger.info('Accepted monitor reconcile request')
        sendJson(res, 200, { success: true })
      } catch (error) {
        logger.error('Failed to process monitor reconcile request', { error })
        sendJson(res, 500, { error: 'Failed to process reconcile request' })
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

    sendJson(res, 404, { error: 'Not found' })
  }
}
