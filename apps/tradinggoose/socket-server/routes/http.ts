import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import {
  buildEntityListDescriptor,
  buildReviewTargetDescriptorFromEnvelope,
  buildSavedEntityDescriptor,
  isEntityListSessionId,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
} from '@/lib/copilot/tools/server/base-tool'
import { preserveDashboardLayoutCredentialPlaceholders } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
} from '@/lib/dashboard-layouts/review-base'
import { env } from '@/lib/env'
import { importWatchlistDocument, WatchlistOperationError } from '@/lib/watchlists/operations'
import { normalizeWatchlistDocumentFields } from '@/lib/watchlists/validation'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import {
  applyDashboardTopologyMutation,
  applyDashboardWidgetConfigPatch,
  readDashboardLayoutContent,
} from '@/lib/yjs/dashboard-layout-session'
import {
  getEntityFields,
  getEntityOwnerUserId,
  getEntityWorkspaceId,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import {
  SavedEntityPersistenceError,
  saveDashboardLayoutYjsDocToDb,
  saveSavedEntityYjsDocToDb,
} from '@/lib/yjs/server/apply-entity-state'
import {
  createEntityListBootstrapUpdate,
  createSavedReviewTargetBootstrapUpdate,
  getRuntimeStateFromDoc,
  reseedEntityListSessionFromDb,
} from '@/lib/yjs/server/bootstrap-review-target'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { replaceWorkflowDocumentState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { replaceWorkflowVariables } from '@/lib/yjs/workflow-variables'
import { getMonitorRuntimeLockHealth } from '@/socket-server/monitor-runtime-lock'
import {
  discardDocument,
  discardDocumentIfIdle,
  flushDocumentPersistence,
  getDocument,
  getExistingDocument,
  markDocumentPersisted,
  reconcileWorkspaceConnections,
  runDocumentMutation,
} from '@/socket-server/yjs/upstream-utils'
import { applyLayoutEditDocument, findDashboardTopologyPanel } from '@/widgets/layout-document'
import {
  applyWidgetConfigMutation,
  type WidgetConfigMutationPatch,
} from '@/widgets/widget-mutations'

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
const INTERNAL_YJS_WATCHLIST_IMPORT_PATH = /^\/internal\/yjs\/watchlists\/([^/]+)\/import$/
const INTERNAL_YJS_DASHBOARD_EDIT_PATH = /^\/internal\/yjs\/dashboard-layouts\/([^/]+)\/edit$/
const INTERNAL_YJS_SNAPSHOT_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/snapshot$/
const INTERNAL_YJS_SESSION_DELETE_PATH = /^\/internal\/yjs\/sessions\/([^/]+)$/
const INTERNAL_YJS_SESSION_APPLY_UPDATE_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/apply-update$/
const INTERNAL_YJS_ENTITY_LIST_MEMBERS_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/members$/
const INTERNAL_YJS_WORKSPACE_ACCESS_PATH = /^\/internal\/yjs\/workspaces\/([^/]+)\/access-changed$/

type ApplyWorkflowStateRequest = {
  workflowState?: WorkflowSnapshot
  variables?: Record<string, any>
}

type SavedEntityKind = Exclude<ReviewEntityKind, 'workflow' | 'dashboard_layout'>

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
  const workflowState = candidate.workflowState

  if (workflowState === undefined && candidate.variables === undefined) {
    throw new InvalidInternalYjsRequestError('workflowState or variables is required')
  }

  if (
    workflowState !== undefined &&
    (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState))
  ) {
    throw new InvalidInternalYjsRequestError('workflowState must be an object')
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
    workflowState: workflowState as WorkflowSnapshot | undefined,
    variables: candidate.variables as Record<string, any> | undefined,
  }
}

function parseApplyEntityStateRequest(body: unknown): ApplyEntityStateRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidInternalYjsRequestError('Invalid apply entity state body')
  }

  const candidate = body as Record<string, unknown>
  const unsupportedField = Object.keys(candidate).find(
    (key) => key !== 'entityKind' && key !== 'fields'
  )
  if (unsupportedField) {
    throw new InvalidInternalYjsRequestError(
      `Unsupported apply entity state field: ${unsupportedField}`
    )
  }
  if (
    candidate.entityKind !== 'skill' &&
    candidate.entityKind !== 'custom_tool' &&
    candidate.entityKind !== 'indicator' &&
    candidate.entityKind !== 'knowledge_base' &&
    candidate.entityKind !== 'mcp_server' &&
    candidate.entityKind !== 'watchlist'
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

async function getInitializedSessionDocument(
  sessionId: string,
  bootstrapState?: Uint8Array
): Promise<Y.Doc> {
  const doc = getDocument(sessionId, true, bootstrapState) as Y.Doc & {
    whenInitialized?: Promise<void>
  }
  await doc.whenInitialized
  return doc
}

async function getBootstrappedApplyDocument(
  descriptor: ReturnType<typeof buildReviewTargetDescriptorFromEnvelope>
): Promise<Y.Doc> {
  const liveDoc = await getExistingDocument(descriptor.yjsSessionId)
  if (liveDoc) {
    return liveDoc
  }

  if (!descriptor.entityId) {
    throw new InvalidInternalYjsRequestError('Saved Yjs session required')
  }

  const bootstrapped = await createSavedReviewTargetBootstrapUpdate(descriptor)
  if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
    throw new Error('Yjs review target is not active')
  }

  return getInitializedSessionDocument(descriptor.yjsSessionId, bootstrapped.state)
}

/**
 * Applies a server-authored mutation durably: the change is staged on a detached
 * copy and persisted before it is reflected into the live collaborative document.
 */
async function applyWorkflowThroughStaging(
  doc: Y.Doc,
  sessionId: string,
  mutate: (target: Y.Doc) => void,
  persist: (staged: Y.Doc) => Promise<void>
): Promise<void> {
  const liveState = Y.encodeStateVector(doc)
  const staging = new Y.Doc()
  Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc))
  try {
    mutate(staging)
    await persist(staging)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(staging, liveState), YJS_ORIGINS.SYSTEM)
    markDocumentPersisted(doc)
  } finally {
    staging.destroy()
    discardDocumentIfIdle(sessionId)
  }
}

function applyWorkflowApplyRequest(doc: Y.Doc, body: ApplyWorkflowStateRequest): void {
  if (body.workflowState) {
    replaceWorkflowDocumentState(doc, body.workflowState, body.variables)
    return
  }
  if (body.variables !== undefined)
    replaceWorkflowVariables(doc, body.variables, YJS_ORIGINS.SYSTEM)
}

async function refreshSavedEntityListDoc(
  entityKind: SavedEntityKind,
  entityDoc: Y.Doc
): Promise<void> {
  const workspaceId = getEntityWorkspaceId(entityDoc)
  const ownerUserId = getEntityOwnerUserId(entityDoc)
  if (!workspaceId) return

  const descriptor = buildEntityListDescriptor(entityKind, workspaceId, {
    ownerUserId,
  })
  const listDoc = await getExistingDocument(descriptor.yjsSessionId)
  if (!listDoc) return

  try {
    await reseedEntityListSessionFromDb(
      listDoc,
      entityKind,
      workspaceId,
      typeof ownerUserId === 'string' ? ownerUserId : null
    )
    markDocumentPersisted(listDoc)
    discardDocumentIfIdle(descriptor.yjsSessionId)
  } catch {
    discardDocument(descriptor.yjsSessionId)
  }
}

async function handleInternalYjsEntityListMembersRequest(
  parsedUrl: URL,
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    if (!isEntityListSessionId(sessionId)) {
      throw new InvalidInternalYjsRequestError('Entity-list session ID is required')
    }

    const liveDoc = await getExistingDocument(sessionId)
    if (!liveDoc) {
      sendJson(res, 200, { success: true, applied: false })
      return
    }

    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      throw new InvalidInternalYjsRequestError('Session ID mismatch')
    }
    // buildReviewTargetDescriptorFromEnvelope rejects entity_list envelopes
    // without a workspaceId, so the cast below cannot see null.
    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    await reseedEntityListSessionFromDb(
      liveDoc,
      descriptor.entityKind,
      descriptor.workspaceId as string,
      descriptor.ownerUserId ?? null
    )
    markDocumentPersisted(liveDoc)
    discardDocumentIfIdle(sessionId)
    sendJson(res, 200, { success: true, applied: true })
  } catch (error) {
    logger.error('Error applying entity-list members', { error, sessionId })
    sendJson(res, error instanceof InvalidInternalYjsRequestError ? 400 : 500, {
      error: error instanceof Error ? error.message : 'Failed to apply entity-list members',
    })
  }
}

async function handleInternalYjsWorkflowApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  workflowId: string
): Promise<void> {
  try {
    const body = parseApplyWorkflowStateRequest(await readJsonBody(req))
    const descriptor = {
      workspaceId: null,
      ownerUserId: null,
      entityKind: 'workflow',
      entityId: workflowId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: workflowId,
    } as const
    const doc = await getBootstrappedApplyDocument(descriptor)
    await runDocumentMutation(doc, () =>
      applyWorkflowThroughStaging(
        doc,
        workflowId,
        (target) => applyWorkflowApplyRequest(target, body),
        (staged) => saveWorkflowYjsDocToDb(workflowId, staged)
      )
    )
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
    let normalizedFields: Record<string, unknown>
    try {
      normalizedFields = normalizeEntityFields(body.entityKind, body.fields)
    } catch (error) {
      throw new InvalidInternalYjsRequestError(
        error instanceof Error ? error.message : 'Invalid saved entity fields'
      )
    }
    const descriptor = buildSavedEntityDescriptor(body.entityKind, entityId, null)
    const doc = await getBootstrappedApplyDocument(descriptor)
    const persistedFields = await runDocumentMutation(doc, async () => {
      seedEntitySession(
        doc,
        { entityKind: body.entityKind, payload: normalizedFields },
        YJS_ORIGINS.SAVE
      )
      clearSessionReseededFromCanonical(doc)
      await flushDocumentPersistence(doc, async (docId, target) => {
        await saveSavedEntityYjsDocToDb(body.entityKind, docId, target)
      })
      await refreshSavedEntityListDoc(body.entityKind, doc)
      return getEntityFields(doc, body.entityKind)
    })

    sendJson(res, 200, { success: true, fields: persistedFields })
  } catch (error) {
    logger.error('Error applying entity state', { error, entityId })
    const status =
      error instanceof InvalidInternalYjsRequestError
        ? 400
        : error instanceof SavedEntityPersistenceError
          ? error.status
          : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply entity state',
    })
  } finally {
    discardDocumentIfIdle(entityId)
  }
}

async function handleInternalWatchlistImportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  try {
    const raw = await readJsonBody(req)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidInternalYjsRequestError('Invalid watchlist import body')
    }
    const body = raw as Record<string, unknown>
    const unsupportedField = Object.keys(body).find(
      (key) => key !== 'workspaceId' && key !== 'fields'
    )
    if (unsupportedField) {
      throw new InvalidInternalYjsRequestError(
        `Unsupported watchlist import field: ${unsupportedField}`
      )
    }
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
    if (!workspaceId) throw new InvalidInternalYjsRequestError('workspaceId is required')
    let fields: ReturnType<typeof normalizeWatchlistDocumentFields>
    try {
      fields = normalizeWatchlistDocumentFields(body.fields)
    } catch (error) {
      throw new InvalidInternalYjsRequestError(
        error instanceof Error ? error.message : 'Invalid watchlist document'
      )
    }

    const descriptor = buildSavedEntityDescriptor('watchlist', entityId, workspaceId)
    const doc = await getBootstrappedApplyDocument(descriptor)
    const committed = await runDocumentMutation(doc, async () => {
      if (getEntityWorkspaceId(doc) !== workspaceId) {
        throw new WatchlistOperationError('Watchlist not found', 404)
      }
      await flushDocumentPersistence(doc)
      const liveState = Y.encodeStateVector(doc)
      const staged = new Y.Doc()
      Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
      try {
        seedEntitySession(staged, {
          entityKind: 'watchlist',
          payload: { settings: fields.settings, items: fields.items },
        })
        const persisted = await importWatchlistDocument({ workspaceId }, entityId, fields)
        Y.applyUpdate(doc, Y.encodeStateAsUpdate(staged, liveState), YJS_ORIGINS.SYSTEM)
        markDocumentPersisted(doc)
        await refreshSavedEntityListDoc('watchlist', doc)
        return persisted
      } finally {
        staged.destroy()
      }
    })

    sendJson(res, 200, { success: true, fields: committed })
  } catch (error) {
    logger.error('Error importing watchlist document', { error, entityId })
    const status =
      error instanceof InvalidInternalYjsRequestError
        ? 400
        : error instanceof WatchlistOperationError
          ? error.status
          : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to import watchlist document',
    })
  } finally {
    discardDocumentIfIdle(entityId)
  }
}

async function handleInternalDashboardEditRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  try {
    const raw = await readJsonBody(req)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidInternalYjsRequestError('Invalid dashboard edit body')
    }
    const body = raw as Record<string, unknown>
    const workspaceId = typeof body.workspaceId === 'string' ? body.workspaceId.trim() : ''
    const ownerUserId = typeof body.ownerUserId === 'string' ? body.ownerUserId.trim() : ''
    const expectedReviewBaseStateHash =
      typeof body.expectedReviewBaseStateHash === 'string'
        ? body.expectedReviewBaseStateHash.trim()
        : ''
    if (!workspaceId || !ownerUserId || !expectedReviewBaseStateHash) {
      throw new InvalidInternalYjsRequestError(
        'workspaceId, ownerUserId, and expectedReviewBaseStateHash are required'
      )
    }

    const descriptor = buildSavedEntityDescriptor('dashboard_layout', entityId, workspaceId, {
      ownerUserId,
    })
    const doc = await getBootstrappedApplyDocument(descriptor)
    const committed = await runDocumentMutation(doc, async () => {
      const current = readDashboardLayoutContent(doc)

      if (body.mutation === 'layout') {
        if (typeof body.entityDocument !== 'string') {
          throw new InvalidInternalYjsRequestError('entityDocument is required')
        }
        const removedPanelIds = Array.isArray(body.removedPanelIds)
          ? body.removedPanelIds.filter((value): value is string => typeof value === 'string')
          : []
        const plan = applyLayoutEditDocument(current, body.entityDocument, removedPanelIds)
        assertAcceptedServerToolReviewBase(
          { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
          hashServerToolReviewBase(buildDashboardLayoutReviewBase(current, plan))
        )
        applyDashboardTopologyMutation(doc, plan)
      } else if (body.mutation === 'widget') {
        const panelId = typeof body.panelId === 'string' ? body.panelId.trim() : ''
        if (
          !panelId ||
          !body.patch ||
          typeof body.patch !== 'object' ||
          Array.isArray(body.patch)
        ) {
          throw new InvalidInternalYjsRequestError('panelId and patch are required')
        }
        const panel = findDashboardTopologyPanel(current.layout, panelId)
        if (!panel?.widgetKey) throw new Error(`Dashboard panel ${panelId} has no widget`)
        const widget = current.widgets[panel.identityId]
        if (!widget) throw new Error(`Dashboard widget ${panel.identityId} is missing`)
        const requestedPatch = body.patch as WidgetConfigMutationPatch
        const mutationPatch: WidgetConfigMutationPatch = {
          pairColor: requestedPatch.pairColor,
          params:
            requestedPatch.params === undefined
              ? undefined
              : (preserveDashboardLayoutCredentialPlaceholders(
                  requestedPatch.params,
                  widget.params
                ) as Record<string, unknown> | null),
          colorPair: requestedPatch.colorPair === undefined ? undefined : requestedPatch.colorPair,
        }
        const planned = applyWidgetConfigMutation({
          widgetKey: panel.widgetKey,
          widget,
          colorPairs: current.colorPairs,
          panelId,
          patch: mutationPatch,
        })
        assertAcceptedServerToolReviewBase(
          { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
          hashServerToolReviewBase(
            buildDashboardWidgetReviewBase(current, panelId, planned.reviewBase, requestedPatch)
          )
        )
        applyDashboardWidgetConfigPatch(doc, panelId, mutationPatch)
      } else {
        throw new InvalidInternalYjsRequestError('Unknown dashboard mutation')
      }

      await flushDocumentPersistence(doc, async (docId, target) => {
        await saveDashboardLayoutYjsDocToDb(docId, target)
      })
      return readDashboardLayoutContent(doc)
    })
    sendJson(res, 200, { success: true, content: committed })
    discardDocumentIfIdle(entityId)
  } catch (error) {
    logger.error('Error applying dashboard edit', { error, entityId })
    if (error instanceof StructuredServerToolError) {
      sendJson(res, error.status, {
        error: error.message,
        code: error.code,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(typeof error.retryable === 'boolean' ? { retryable: error.retryable } : {}),
      })
      return
    }
    const status =
      error instanceof InvalidInternalYjsRequestError
        ? 400
        : error instanceof SavedEntityPersistenceError
          ? error.status
          : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply dashboard edit',
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
    try {
      const doc = await getBootstrappedApplyDocument(descriptor)
      await runDocumentMutation(doc, async () => {
        // Client explicit-save flush: merge the user's collaborative draft first,
        // then materialize it. Persistence failure keeps the draft for correction.
        Y.applyUpdate(doc, Buffer.from(updateBase64, 'base64'), YJS_ORIGINS.SAVE)
        clearSessionReseededFromCanonical(doc)
        if (descriptor.entityId && descriptor.entityKind !== 'workflow') {
          if (descriptor.entityKind === 'dashboard_layout') {
            await flushDocumentPersistence(doc, async (docId, target) => {
              await saveDashboardLayoutYjsDocToDb(docId, target)
            })
          } else {
            const entityKind: SavedEntityKind = descriptor.entityKind
            await flushDocumentPersistence(doc, async (docId, target) => {
              await saveSavedEntityYjsDocToDb(entityKind, docId, target)
              await refreshSavedEntityListDoc(entityKind, target)
            })
          }
        }
      })
      discardDocumentIfIdle(sessionId)
    } catch (error) {
      discardDocumentIfIdle(descriptor.yjsSessionId)
      throw error
    }

    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error applying Yjs session update', { error, path: parsedUrl.pathname })
    const status =
      error instanceof InvalidInternalYjsRequestError
        ? 400
        : error instanceof SavedEntityPersistenceError
          ? error.status
          : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to apply session update',
    })
  }
}

async function handleInternalYjsSnapshotRequest(
  parsedUrl: URL,
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  let descriptor: ReturnType<typeof buildReviewTargetDescriptorFromEnvelope>
  try {
    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      sendJson(res, 409, { error: 'Session ID mismatch', sessionId })
      return
    }

    descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
  } catch (error) {
    logger.error('Invalid Yjs snapshot request', { error, path: parsedUrl.pathname })
    sendJson(res, 400, {
      error: error instanceof Error ? error.message : 'Invalid Yjs snapshot request',
    })
    return
  }

  try {
    let liveDoc = await getExistingDocument(sessionId)
    let bootstrappedForRequest = false
    if (!liveDoc) {
      const bootstrapped = isEntityListSessionId(descriptor.yjsSessionId)
        ? await createEntityListBootstrapUpdate(
            descriptor.entityKind,
            descriptor.workspaceId as string,
            descriptor.ownerUserId ?? null
          )
        : descriptor.entityId
          ? await createSavedReviewTargetBootstrapUpdate(descriptor)
          : null
      if (bootstrapped) {
        if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
          sendJson(res, 410, { error: 'Session expired', sessionId })
          return
        }
        liveDoc = await getInitializedSessionDocument(sessionId, bootstrapped.state)
        bootstrappedForRequest = true
      }
    }

    if (!liveDoc) {
      sendJson(res, 404, { error: 'Session not found', sessionId })
      return
    }

    if (isEntityListSessionId(descriptor.yjsSessionId) && !bootstrappedForRequest) {
      try {
        await reseedEntityListSessionFromDb(
          liveDoc,
          descriptor.entityKind,
          descriptor.workspaceId as string,
          descriptor.ownerUserId ?? null
        )
        markDocumentPersisted(liveDoc)
      } catch (error) {
        logger.warn('Failed to reseed existing entity-list snapshot; serving live projection', {
          error,
          sessionId,
        })
      }
    }

    const state = Y.encodeStateAsUpdate(liveDoc)

    sendJson(res, 200, {
      snapshotBase64: Buffer.from(state).toString('base64'),
      descriptor,
      runtime: getRuntimeStateFromDoc(liveDoc),
      touchedAt: null,
    })
    const retainDashboardLayout =
      descriptor.entityKind === 'dashboard_layout' && descriptor.entityId !== null
    if (bootstrappedForRequest && !retainDashboardLayout) {
      discardDocumentIfIdle(sessionId)
    }
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    const status = Number((error as { status?: unknown }).status) || 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to get snapshot',
    })
  }
}

async function handleInternalYjsSessionDeleteRequest(
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    discardDocument(sessionId)
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error deleting Yjs session', { error, sessionId })
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Failed to delete Yjs session',
    })
  }
}

async function handleInternalWorkspaceAccessChangedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  workspaceId: string
): Promise<void> {
  try {
    const raw = await readJsonBody(req)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidInternalYjsRequestError('Invalid workspace access body')
    }
    const candidate = raw as Record<string, unknown>
    const userIds = Array.isArray(candidate.userIds)
      ? candidate.userIds.filter((value): value is string => typeof value === 'string' && !!value)
      : null
    await reconcileWorkspaceConnections(
      workspaceId,
      userIds && userIds.length > 0 ? new Set(userIds) : undefined
    )
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Failed to reconcile workspace Yjs access', { error, workspaceId })
    sendJson(res, error instanceof InvalidInternalYjsRequestError ? 400 : 500, {
      error: error instanceof Error ? error.message : 'Failed to reconcile workspace access',
    })
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

  const importWatchlistId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_WATCHLIST_IMPORT_PATH,
    'POST',
    req.method
  )
  if (importWatchlistId) {
    await handleInternalWatchlistImportRequest(req, res, logger, importWatchlistId)
    return true
  }

  const dashboardEditId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_DASHBOARD_EDIT_PATH,
    'POST',
    req.method
  )
  if (dashboardEditId) {
    await handleInternalDashboardEditRequest(req, res, logger, dashboardEditId)
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

  const memberListId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_ENTITY_LIST_MEMBERS_PATH,
    'POST',
    req.method
  )
  if (memberListId) {
    await handleInternalYjsEntityListMembersRequest(parsedUrl, res, logger, memberListId)
    return true
  }

  const deleteSessionId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_SESSION_DELETE_PATH,
    'DELETE',
    req.method
  )
  if (deleteSessionId) {
    await handleInternalYjsSessionDeleteRequest(res, logger, deleteSessionId)
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

  const accessWorkspaceId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_WORKSPACE_ACCESS_PATH,
    'POST',
    req.method
  )
  if (accessWorkspaceId) {
    await handleInternalWorkspaceAccessChangedRequest(req, res, logger, accessWorkspaceId)
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
