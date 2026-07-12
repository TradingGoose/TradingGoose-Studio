import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import { normalizeEntityFields } from '@/lib/copilot/entity-documents'
import {
  buildDashboardColorPairDescriptor,
  buildDashboardWidgetDescriptor,
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
  throwStaleServerToolReview,
} from '@/lib/copilot/tools/server/base-tool'
import { commitDashboardLayoutStructure } from '@/lib/dashboard-layouts/operations'
import { preserveDashboardLayoutCredentialPlaceholders } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
} from '@/lib/dashboard-layouts/review-base'
import { env } from '@/lib/env'
import type { SavedEntityIdentityMutation } from '@/lib/saved-entities/identity'
import { importWatchlistDocument, WatchlistOperationError } from '@/lib/watchlists/operations'
import { normalizeWatchlistDocumentFields } from '@/lib/watchlists/validation'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import {
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  seedDashboardColorPairSession,
  seedDashboardWidgetSession,
  setDashboardColorPairDocument,
  setDashboardLayoutTopology,
  setDashboardWidgetDocument,
} from '@/lib/yjs/dashboard-layout-session'
import {
  getEntityFields,
  getEntityOwnerUserId,
  getEntityWorkspaceId,
  seedEntitySession,
} from '@/lib/yjs/entity-session'
import {
  SavedEntityPersistenceError,
  saveDashboardColorPairYjsDocToDb,
  saveDashboardWidgetYjsDocToDb,
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
  abortYjsSessionDeletion,
  beginYjsSessionDeletion,
  commitYjsSessionDeletion,
  discardDocument,
  discardDocumentIfCurrent,
  discardDocumentIfIdle,
  flushDocumentPersistence,
  getDocument,
  getExistingDocument,
  markDocumentPersisted,
  reconcileWorkspaceConnections,
  runDocumentMutation,
  YjsSessionAdmissionError,
} from '@/socket-server/yjs/upstream-utils'
import { readPairColorContext } from '@/widgets/color-pairs'
import {
  applyDashboardLayoutStructureMutation,
  applyLayoutEditDocument,
  createDefaultDashboardWidgetDocument,
  type DashboardLayoutEditPlan,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
  findDashboardTopologyPanel,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'
import { PAIR_COLORS } from '@/widgets/pair-colors'
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
const INTERNAL_YJS_DELETION_BEGIN_PATH = '/internal/yjs/session-deletions'
const INTERNAL_YJS_DELETION_COMMIT_PATH = /^\/internal\/yjs\/session-deletions\/([^/]+)\/commit$/
const INTERNAL_YJS_DELETION_ABORT_PATH = /^\/internal\/yjs\/session-deletions\/([^/]+)$/
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
  expectedReviewBaseStateHash?: string
  identity?: SavedEntityIdentityMutation
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

function parseSavedEntityIdentityMutation(value: unknown): SavedEntityIdentityMutation | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidInternalYjsRequestError('identity must be an object')
  }
  const rawIdentity = value as Record<string, unknown>
  const unsupportedField = Object.keys(rawIdentity).find((key) => key !== 'name')
  if (unsupportedField) {
    throw new InvalidInternalYjsRequestError(
      `Unsupported saved entity identity field: ${unsupportedField}`
    )
  }
  if (typeof rawIdentity.name !== 'string' || !rawIdentity.name.trim()) {
    throw new InvalidInternalYjsRequestError('identity.name is required')
  }
  return { name: rawIdentity.name }
}

function parseApplyEntityStateRequest(body: unknown): ApplyEntityStateRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new InvalidInternalYjsRequestError('Invalid apply entity state body')
  }

  const candidate = body as Record<string, unknown>
  const unsupportedField = Object.keys(candidate).find(
    (key) =>
      key !== 'entityKind' &&
      key !== 'fields' &&
      key !== 'expectedReviewBaseStateHash' &&
      key !== 'identity'
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

  const expectedReviewBaseStateHash =
    candidate.expectedReviewBaseStateHash === undefined
      ? undefined
      : typeof candidate.expectedReviewBaseStateHash === 'string'
        ? candidate.expectedReviewBaseStateHash.trim()
        : ''
  if (candidate.expectedReviewBaseStateHash !== undefined && !expectedReviewBaseStateHash) {
    throw new InvalidInternalYjsRequestError('expectedReviewBaseStateHash must be a string')
  }

  const identity = parseSavedEntityIdentityMutation(candidate.identity)

  return {
    entityKind: candidate.entityKind,
    fields: candidate.fields as Record<string, any>,
    ...(expectedReviewBaseStateHash ? { expectedReviewBaseStateHash } : {}),
    ...(identity ? { identity } : {}),
  }
}

function clearSessionReseededFromCanonical(doc: Y.Doc): void {
  doc.transact(() => {
    doc.getMap('metadata').delete('reseededFromCanonical')
  }, YJS_ORIGINS.SYSTEM)
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

  return getDocument(descriptor.yjsSessionId, true, bootstrapped.state).doc
}

/**
 * Applies a server-authored mutation durably: the change is staged on a detached
 * copy and persisted before it is reflected into the live collaborative document.
 */
async function applyThroughStaging<T>(
  doc: Y.Doc,
  mutate: (target: Y.Doc) => void,
  persist: (staged: Y.Doc) => Promise<T>
): Promise<T> {
  const liveState = Y.encodeStateVector(doc)
  const staging = new Y.Doc()
  Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
  try {
    mutate(staging)
    const persisted = await persist(staging)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(staging, liveState), YJS_ORIGINS.SYSTEM)
    markDocumentPersisted(doc)
    return persisted
  } finally {
    staging.destroy()
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
    discardDocumentIfIdle(listDoc)
  } catch {
    await discardDocumentIfCurrent(listDoc)
  }
}

async function applySavedEntityThroughStaging(input: {
  doc: Y.Doc
  entityId: string
  entityKind: SavedEntityKind
  identity?: SavedEntityIdentityMutation
  validate?: (current: Y.Doc) => void
  mutate: (staged: Y.Doc) => void
}): Promise<Record<string, unknown>> {
  await flushDocumentPersistence(input.doc)
  input.validate?.(input.doc)
  const persisted = await applyThroughStaging(
    input.doc,
    (staged) => {
      input.mutate(staged)
      clearSessionReseededFromCanonical(staged)
    },
    (staged) =>
      saveSavedEntityYjsDocToDb(
        input.entityKind,
        input.entityId,
        staged,
        input.identity ? { identity: input.identity } : undefined
      )
  )
  await refreshSavedEntityListDoc(input.entityKind, input.doc)
  return persisted
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
    try {
      await reseedEntityListSessionFromDb(
        liveDoc,
        descriptor.entityKind as ReviewEntityKind,
        descriptor.workspaceId as string,
        descriptor.ownerUserId ?? null
      )
    } catch (error) {
      await discardDocumentIfCurrent(liveDoc)
      throw error
    }
    markDocumentPersisted(liveDoc)
    discardDocumentIfIdle(liveDoc)
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
  let cleanupDoc: Y.Doc | null = null
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
    cleanupDoc = doc
    await runDocumentMutation(doc, () =>
      applyThroughStaging(
        doc,
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
  } finally {
    if (cleanupDoc) discardDocumentIfIdle(cleanupDoc)
  }
}

async function handleInternalYjsEntityApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  let cleanupDoc: Y.Doc | null = null
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
    cleanupDoc = doc
    const persistedFields = await runDocumentMutation(doc, () =>
      applySavedEntityThroughStaging({
        doc,
        entityId,
        entityKind: body.entityKind,
        identity: body.identity,
        validate: body.expectedReviewBaseStateHash
          ? (current) =>
              assertAcceptedServerToolReviewBase(
                {
                  userId: 'internal-realtime',
                  acceptedReviewBaseStateHash: body.expectedReviewBaseStateHash,
                },
                hashServerToolReviewBase(getEntityFields(current, body.entityKind))
              )
          : undefined,
        mutate: (staged) => {
          seedEntitySession(
            staged,
            { entityKind: body.entityKind, payload: normalizedFields },
            YJS_ORIGINS.SAVE
          )
        },
      })
    )

    sendJson(res, 200, { success: true, fields: persistedFields })
  } catch (error) {
    logger.error('Error applying entity state', { error, entityId })
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
    sendJson(
      res,
      status,
      error instanceof SavedEntityPersistenceError
        ? error.responseBody()
        : { error: error instanceof Error ? error.message : 'Failed to apply entity state' }
    )
  } finally {
    if (cleanupDoc) discardDocumentIfIdle(cleanupDoc)
  }
}

async function handleInternalWatchlistImportRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  let cleanupDoc: Y.Doc | null = null
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
    cleanupDoc = doc
    const committed = await runDocumentMutation(doc, async () => {
      if (getEntityWorkspaceId(doc) !== workspaceId) {
        throw new WatchlistOperationError('Watchlist not found', 404)
      }
      await flushDocumentPersistence(doc)
      const persisted = await applyThroughStaging(
        doc,
        (staged) =>
          seedEntitySession(staged, {
            entityKind: 'watchlist',
            payload: { settings: fields.settings, items: fields.items },
          }),
        () => importWatchlistDocument({ workspaceId }, entityId, fields)
      )
      await refreshSavedEntityListDoc('watchlist', doc)
      return persisted
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
    if (cleanupDoc) discardDocumentIfIdle(cleanupDoc)
  }
}

async function readDashboardProjectionFromLiveOwners(input: {
  layoutDoc: Y.Doc
  layoutId: string
  workspaceId: string
  ownerUserId: string
}): Promise<DashboardLayoutProjectionContent> {
  const document = readDashboardLayoutDocument(input.layoutDoc)
  const panels: Array<Extract<DashboardLayoutTopologyNode, { type: 'panel' }>> = []
  const collect = (node: DashboardLayoutTopologyNode) => {
    if (node.type === 'panel') panels.push(node)
    else node.children.forEach(collect)
  }
  collect(document.layout)
  const widgets = Object.fromEntries(
    await Promise.all(
      panels.map(async (panel) => {
        const descriptor = buildDashboardWidgetDescriptor({
          layoutId: input.layoutId,
          identityId: panel.identityId,
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
        })
        const doc = await getBootstrappedApplyDocument(descriptor)
        try {
          return [panel.identityId, readDashboardWidgetDocument(doc, panel.widgetKey)] as const
        } finally {
          discardDocumentIfIdle(doc)
        }
      })
    )
  )
  const pairs = (
    await Promise.all(
      PAIR_COLORS.filter((color) => color !== 'gray').map(async (color) => {
        const descriptor = buildDashboardColorPairDescriptor({
          layoutId: input.layoutId,
          color,
          workspaceId: input.workspaceId,
          ownerUserId: input.ownerUserId,
        })
        const doc = await getBootstrappedApplyDocument(descriptor)
        try {
          const context = readDashboardColorPairDocument(doc)
          return Object.keys(context).length > 0 ? { color, ...context } : null
        } finally {
          discardDocumentIfIdle(doc)
        }
      })
    )
  ).filter((pair) => pair !== null)
  return normalizeDashboardLayoutProjection({
    ...document,
    widgets,
    colorPairs: { pairs },
  })
}

function parseDashboardStructureMutation(value: unknown): DashboardLayoutStructureMutation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidInternalYjsRequestError('structure is required')
  }
  const structure = value as Record<string, unknown>
  if (structure.type === 'resize') {
    const groupId = typeof structure.groupId === 'string' ? structure.groupId.trim() : ''
    const rawSizes = Array.isArray(structure.sizes) ? structure.sizes : []
    const sizes = rawSizes.filter((size): size is number => typeof size === 'number')
    if (
      !groupId ||
      sizes.length !== rawSizes.length ||
      sizes.some((size) => !Number.isFinite(size))
    ) {
      throw new InvalidInternalYjsRequestError('structure resize is invalid')
    }
    return { type: 'resize', groupId, sizes }
  }
  const panelId = typeof structure.panelId === 'string' ? structure.panelId.trim() : ''
  if (!panelId) throw new InvalidInternalYjsRequestError('structure.panelId is required')

  if (structure.type === 'split') {
    if (structure.direction !== 'horizontal' && structure.direction !== 'vertical') {
      throw new InvalidInternalYjsRequestError('structure.direction is invalid')
    }
    return { type: 'split', panelId, direction: structure.direction }
  }
  if (structure.type === 'close') return { type: 'close', panelId }
  if (structure.type === 'replace') {
    if (typeof structure.widgetKey !== 'string' || !structure.widgetKey.trim()) {
      throw new InvalidInternalYjsRequestError('structure.widgetKey is required')
    }
    return { type: 'replace', panelId, widgetKey: structure.widgetKey.trim() }
  }
  throw new InvalidInternalYjsRequestError('structure.type is invalid')
}

async function commitDashboardStructurePlan(input: {
  layoutDoc: Y.Doc
  layoutId: string
  workspaceId: string
  ownerUserId: string
  current: DashboardLayoutProjectionContent
  plan: DashboardLayoutEditPlan
}): Promise<DashboardLayoutProjectionContent> {
  const createdWidgets = input.plan.createdBindings.map((binding) => {
    const source = binding.sourceIdentityId
      ? input.current.widgets[binding.sourceIdentityId]
      : undefined
    if (binding.sourceIdentityId && !source) {
      throw new Error(`Dashboard widget ${binding.sourceIdentityId} is missing`)
    }
    return {
      binding,
      document: source ?? createDefaultDashboardWidgetDocument(binding.widgetKey),
    }
  })
  const removedSessionIds = input.plan.removedIdentityIds.map(
    (identityId) =>
      buildDashboardWidgetDescriptor({
        layoutId: input.layoutId,
        identityId,
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
      }).yjsSessionId
  )
  const deletionLeaseId =
    removedSessionIds.length > 0 ? await beginYjsSessionDeletion(removedSessionIds) : null

  try {
    await applyThroughStaging(
      input.layoutDoc,
      (staged) => setDashboardLayoutTopology(staged, input.plan.layout),
      (staged) =>
        commitDashboardLayoutStructure(
          { workspaceId: input.workspaceId, ownerUserId: input.ownerUserId },
          input.layoutId,
          {
            layout: readDashboardLayoutDocument(staged).layout,
            createdWidgets,
            removedIdentityIds: input.plan.removedIdentityIds,
          }
        )
    )
    if (deletionLeaseId) commitYjsSessionDeletion(deletionLeaseId)
  } catch (error) {
    if (deletionLeaseId) abortYjsSessionDeletion(deletionLeaseId)
    throw error
  }

  return readDashboardProjectionFromLiveOwners({
    layoutDoc: input.layoutDoc,
    layoutId: input.layoutId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
  })
}

async function handleInternalDashboardEditRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  let cleanupLayoutDoc: Y.Doc | null = null
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
    if (!workspaceId || !ownerUserId) {
      throw new InvalidInternalYjsRequestError('workspaceId and ownerUserId are required')
    }
    if (body.mutation !== 'structure' && !expectedReviewBaseStateHash) {
      throw new InvalidInternalYjsRequestError('expectedReviewBaseStateHash is required')
    }

    const descriptor = buildSavedEntityDescriptor('dashboard_layout', entityId, workspaceId, {
      ownerUserId,
    })
    const layoutDoc = await getBootstrappedApplyDocument(descriptor)
    cleanupLayoutDoc = layoutDoc
    let committed: DashboardLayoutProjectionContent
    if (body.mutation === 'layout') {
      committed = await runDocumentMutation(layoutDoc, async () => {
        await flushDocumentPersistence(layoutDoc)
        if (typeof body.entityDocument !== 'string') {
          throw new InvalidInternalYjsRequestError('entityDocument is required')
        }
        const removedPanelIds = Array.isArray(body.removedPanelIds)
          ? body.removedPanelIds.filter((value): value is string => typeof value === 'string')
          : []
        const currentProjection = await readDashboardProjectionFromLiveOwners({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
        })
        const current = { layout: currentProjection.layout }
        const plan = applyLayoutEditDocument(current, body.entityDocument, removedPanelIds)
        assertAcceptedServerToolReviewBase(
          { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
          hashServerToolReviewBase(buildDashboardLayoutReviewBase(current, plan))
        )
        return commitDashboardStructurePlan({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
          current: currentProjection,
          plan,
        })
      })
    } else if (body.mutation === 'structure') {
      const structure = parseDashboardStructureMutation(body.structure)
      committed = await runDocumentMutation(layoutDoc, async () => {
        await flushDocumentPersistence(layoutDoc)
        const current = await readDashboardProjectionFromLiveOwners({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
        })
        const plan = applyDashboardLayoutStructureMutation(current.layout, structure)
        return commitDashboardStructurePlan({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
          current,
          plan,
        })
      })
    } else if (body.mutation === 'widget') {
      const panelId = typeof body.panelId === 'string' ? body.panelId.trim() : ''
      if (!panelId || !body.patch || typeof body.patch !== 'object' || Array.isArray(body.patch)) {
        throw new InvalidInternalYjsRequestError('panelId and patch are required')
      }
      const requestedPatch = body.patch as WidgetConfigMutationPatch
      const initial = await readDashboardProjectionFromLiveOwners({
        layoutDoc,
        layoutId: entityId,
        workspaceId,
        ownerUserId,
      })
      const panel = findDashboardTopologyPanel(initial.layout, panelId)
      if (!panel?.widgetKey) throw new Error(`Dashboard panel ${panelId} has no widget`)
      const widget = initial.widgets[panel.identityId]
      if (!widget) throw new Error(`Dashboard widget ${panel.identityId} is missing`)
      const initialMutationPatch: WidgetConfigMutationPatch = {
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
      const initialPlan = applyWidgetConfigMutation({
        widgetKey: panel.widgetKey,
        widget,
        colorPairs: initial.colorPairs,
        panelId,
        patch: initialMutationPatch,
      })
      const widgetDescriptor = buildDashboardWidgetDescriptor({
        layoutId: entityId,
        identityId: panel.identityId,
        workspaceId,
        ownerUserId,
      })
      const widgetDoc = await getBootstrappedApplyDocument(widgetDescriptor)
      const pairColor = initialPlan.reviewBase.colorPair?.color ?? null
      const pairDescriptor = pairColor
        ? buildDashboardColorPairDescriptor({
            layoutId: entityId,
            color: pairColor,
            workspaceId,
            ownerUserId,
          })
        : null
      let pairDoc: Y.Doc | null = null
      try {
        pairDoc = pairDescriptor ? await getBootstrappedApplyDocument(pairDescriptor) : null
        const applyLockedEdit = async () => {
          if (pairDoc) await flushDocumentPersistence(pairDoc)
          await flushDocumentPersistence(widgetDoc)
          const current = await readDashboardProjectionFromLiveOwners({
            layoutDoc,
            layoutId: entityId,
            workspaceId,
            ownerUserId,
          })
          const currentPanel = findDashboardTopologyPanel(current.layout, panelId)
          if (
            !currentPanel?.widgetKey ||
            currentPanel.identityId !== panel.identityId ||
            currentPanel.widgetKey !== panel.widgetKey
          ) {
            throwStaleServerToolReview()
          }
          const currentWidget = current.widgets[currentPanel.identityId]
          if (!currentWidget)
            throw new Error(`Dashboard widget ${currentPanel.identityId} is missing`)
          const mutationPatch: WidgetConfigMutationPatch = {
            pairColor: requestedPatch.pairColor,
            params:
              requestedPatch.params === undefined
                ? undefined
                : (preserveDashboardLayoutCredentialPlaceholders(
                    requestedPatch.params,
                    currentWidget.params
                  ) as Record<string, unknown> | null),
            colorPair:
              requestedPatch.colorPair === undefined ? undefined : requestedPatch.colorPair,
          }
          const planned = applyWidgetConfigMutation({
            widgetKey: currentPanel.widgetKey,
            widget: currentWidget,
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
          if ((planned.reviewBase.colorPair?.color ?? null) !== pairColor) {
            throwStaleServerToolReview()
          }
          if (planned.colorPairDiff.length > 0 && pairDoc && pairDescriptor) {
            const nextContext = readPairColorContext(
              planned.colorPairs,
              planned.widgetDocument.pairColor
            )
            await applyThroughStaging(
              pairDoc,
              (staged) => setDashboardColorPairDocument(staged, nextContext),
              (staged) => saveDashboardColorPairYjsDocToDb(pairDescriptor.yjsSessionId, staged)
            )
          }
          if (planned.changedPaths.some((path) => path.startsWith('widget.'))) {
            await applyThroughStaging(
              widgetDoc,
              (staged) =>
                setDashboardWidgetDocument(staged, currentPanel.widgetKey, planned.widgetDocument),
              (staged) => saveDashboardWidgetYjsDocToDb(widgetDescriptor.yjsSessionId, staged)
            )
          }
        }
        await runDocumentMutation(layoutDoc, () =>
          pairDoc
            ? runDocumentMutation(pairDoc, () => runDocumentMutation(widgetDoc, applyLockedEdit))
            : runDocumentMutation(widgetDoc, applyLockedEdit)
        )
        committed = await readDashboardProjectionFromLiveOwners({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
        })
      } finally {
        if (pairDoc) discardDocumentIfIdle(pairDoc)
        discardDocumentIfIdle(widgetDoc)
      }
    } else {
      throw new InvalidInternalYjsRequestError('Unknown dashboard mutation')
    }
    sendJson(res, 200, { success: true, content: committed })
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
  } finally {
    if (cleanupLayoutDoc) discardDocumentIfIdle(cleanupLayoutDoc)
  }
}

async function handleInternalYjsSessionApplyUpdateRequest(
  req: IncomingMessage,
  parsedUrl: URL,
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  let cleanupDoc: Y.Doc | null = null
  try {
    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      sendJson(res, 409, { error: 'Session ID mismatch', sessionId })
      return
    }

    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    const entityKind = descriptor.entityKind
    if (entityKind === 'dashboard_layout') {
      throw new InvalidInternalYjsRequestError(
        'Dashboard layout updates require the structural edit route'
      )
    }
    const rawBody = await readJsonBody(req)
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      throw new InvalidInternalYjsRequestError('Invalid apply session update body')
    }
    const body = rawBody as Record<string, unknown>
    const unsupportedField = Object.keys(body).find(
      (key) => key !== 'updateBase64' && key !== 'identity'
    )
    if (unsupportedField) {
      throw new InvalidInternalYjsRequestError(
        `Unsupported apply session update field: ${unsupportedField}`
      )
    }
    const updateBase64 = body.updateBase64
    if (typeof updateBase64 !== 'string' || !updateBase64) {
      throw new InvalidInternalYjsRequestError('updateBase64 is required')
    }
    const identity = parseSavedEntityIdentityMutation(body.identity)
    if (identity && (entityKind === 'dashboard_widget' || entityKind === 'dashboard_color_pair')) {
      throw new InvalidInternalYjsRequestError('Dashboard document identity is not saved here')
    }
    const doc = await getBootstrappedApplyDocument(descriptor)
    cleanupDoc = doc
    const submitted = new Y.Doc()
    try {
      Y.applyUpdate(submitted, Buffer.from(updateBase64, 'base64'), YJS_ORIGINS.SAVE)
      await runDocumentMutation(doc, async () => {
        if (!descriptor.entityId || entityKind === 'workflow') return
        if (entityKind === 'dashboard_widget') {
          const content = readDashboardWidgetDocument(submitted)
          await flushDocumentPersistence(doc)
          await applyThroughStaging(
            doc,
            (staged) => {
              seedDashboardWidgetSession(staged, content, YJS_ORIGINS.SAVE)
              clearSessionReseededFromCanonical(staged)
            },
            (staged) => saveDashboardWidgetYjsDocToDb(descriptor.yjsSessionId, staged)
          )
          return
        }

        if (entityKind === 'dashboard_color_pair') {
          const content = readDashboardColorPairDocument(submitted)
          await flushDocumentPersistence(doc)
          await applyThroughStaging(
            doc,
            (staged) => {
              seedDashboardColorPairSession(staged, content, YJS_ORIGINS.SAVE)
              clearSessionReseededFromCanonical(staged)
            },
            (staged) => saveDashboardColorPairYjsDocToDb(descriptor.yjsSessionId, staged)
          )
          return
        }

        const fields = getEntityFields(submitted, entityKind)
        await applySavedEntityThroughStaging({
          doc,
          entityId: descriptor.entityId,
          entityKind,
          identity,
          mutate: (staged) =>
            seedEntitySession(staged, { entityKind, payload: fields }, YJS_ORIGINS.SAVE),
        })
      })
    } finally {
      submitted.destroy()
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
    sendJson(
      res,
      status,
      error instanceof SavedEntityPersistenceError
        ? error.responseBody()
        : { error: error instanceof Error ? error.message : 'Failed to apply session update' }
    )
  } finally {
    if (cleanupDoc) discardDocumentIfIdle(cleanupDoc)
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

  let requestCreatedDoc: Y.Doc | null = null
  try {
    let liveDoc = await getExistingDocument(sessionId)
    let bootstrappedForRequest = false
    if (!liveDoc) {
      const bootstrapped = isEntityListSessionId(descriptor.yjsSessionId)
        ? await createEntityListBootstrapUpdate(
            descriptor.entityKind as ReviewEntityKind,
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
        const acquired = getDocument(sessionId, true, bootstrapped.state)
        liveDoc = acquired.doc
        bootstrappedForRequest = acquired.created
        if (acquired.created) requestCreatedDoc = acquired.doc
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
          descriptor.entityKind as ReviewEntityKind,
          descriptor.workspaceId as string,
          descriptor.ownerUserId ?? null
        )
        markDocumentPersisted(liveDoc)
      } catch (error) {
        logger.warn('Failed to reseed existing entity-list snapshot', {
          error,
          sessionId,
        })
        await discardDocumentIfCurrent(liveDoc)
        throw error
      }
    }

    const state = Y.encodeStateAsUpdate(liveDoc)

    sendJson(res, 200, {
      snapshotBase64: Buffer.from(state).toString('base64'),
      descriptor,
      runtime: getRuntimeStateFromDoc(liveDoc),
      touchedAt: null,
    })
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    const status = Number((error as { status?: unknown }).status) || 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to get snapshot',
    })
  } finally {
    if (requestCreatedDoc) discardDocumentIfIdle(requestCreatedDoc)
  }
}

async function handleInternalYjsSessionDeleteRequest(
  res: ServerResponse,
  logger: Logger,
  sessionId: string
): Promise<void> {
  try {
    await discardDocument(sessionId)
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error deleting Yjs session', { error, sessionId })
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Failed to delete Yjs session',
    })
  }
}

async function handleInternalYjsDeletionBeginRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger
): Promise<void> {
  try {
    const raw = await readJsonBody(req)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidInternalYjsRequestError('Invalid Yjs deletion lease body')
    }
    const sessionIds = (raw as Record<string, unknown>).sessionIds
    if (!Array.isArray(sessionIds) || !sessionIds.every((value) => typeof value === 'string')) {
      throw new InvalidInternalYjsRequestError('sessionIds must be an array of strings')
    }
    const leaseId = await beginYjsSessionDeletion(sessionIds)
    sendJson(res, 200, { leaseId })
  } catch (error) {
    logger.error('Failed to begin Yjs deletion lease', { error })
    const status =
      error instanceof InvalidInternalYjsRequestError
        ? 400
        : error instanceof YjsSessionAdmissionError
          ? 409
          : 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to begin Yjs deletion lease',
    })
  }
}

function handleInternalYjsDeletionCommitRequest(
  res: ServerResponse,
  logger: Logger,
  leaseId: string
): void {
  try {
    commitYjsSessionDeletion(leaseId)
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Failed to commit Yjs deletion lease', { error, leaseId })
    sendJson(res, 409, {
      error: error instanceof Error ? error.message : 'Failed to commit Yjs deletion lease',
    })
  }
}

function handleInternalYjsDeletionAbortRequest(res: ServerResponse, leaseId: string): void {
  abortYjsSessionDeletion(leaseId)
  sendJson(res, 200, { success: true })
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

  if (req.method === 'POST' && parsedUrl.pathname === INTERNAL_YJS_DELETION_BEGIN_PATH) {
    await handleInternalYjsDeletionBeginRequest(req, res, logger)
    return true
  }

  const commitDeletionLeaseId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_DELETION_COMMIT_PATH,
    'POST',
    req.method
  )
  if (commitDeletionLeaseId) {
    handleInternalYjsDeletionCommitRequest(res, logger, commitDeletionLeaseId)
    return true
  }

  const abortDeletionLeaseId = matchInternalRoute(
    parsedUrl.pathname,
    INTERNAL_YJS_DELETION_ABORT_PATH,
    'DELETE',
    req.method
  )
  if (abortDeletionLeaseId) {
    handleInternalYjsDeletionAbortRequest(res, abortDeletionLeaseId)
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
