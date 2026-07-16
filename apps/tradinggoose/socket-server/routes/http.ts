import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import * as Y from 'yjs'
import {
  McpServerSecretPlaceholderError,
  normalizeEntityFields,
  resolveMcpServerSecretPlaceholders,
} from '@/lib/copilot/entity-documents'
import {
  buildDashboardColorPairDescriptor,
  buildDashboardWidgetDescriptor,
  buildReviewTargetDescriptorFromEnvelope,
  buildSavedEntityDescriptor,
  isEntityListSessionId,
  parseYjsTransportEnvelope,
} from '@/lib/copilot/review-sessions/identity'
import { getReviewTargetRuntimeState } from '@/lib/copilot/review-sessions/runtime'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
} from '@/lib/copilot/tools/server/base-tool'
import {
  commitDashboardLayoutStructure,
  DashboardLayoutOperationError,
} from '@/lib/dashboard-layouts/operations'
import { preserveDashboardLayoutCredentialPlaceholders } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
} from '@/lib/dashboard-layouts/review-base'
import { env } from '@/lib/env'
import type { SavedEntityIdentityMutation } from '@/lib/saved-entities/identity'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import {
  applyDashboardColorPairDocumentDelta,
  applyDashboardWidgetDocumentDelta,
  readDashboardColorPairDocument,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  setDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import {
  SavedEntityPersistenceError,
  saveDashboardColorPairYjsDocToDb,
  saveDashboardWidgetYjsDocToDb,
  saveSavedEntityYjsDocToDb,
} from '@/lib/yjs/server/apply-entity-state'
import { createSavedReviewTargetBootstrapUpdate } from '@/lib/yjs/server/bootstrap-review-target'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { replaceWorkflowDocumentState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { replaceWorkflowVariables } from '@/lib/yjs/workflow-variables'
import { getMonitorRuntimeLockHealth } from '@/socket-server/monitor-runtime-lock'
import { refreshActiveEntityListSession } from '@/socket-server/yjs/entity-list-session'
import {
  abortYjsSessionDeletion,
  beginYjsSessionDeletion,
  commitYjsSessionDeletion,
  discardDocumentIfIdle,
  flushDocumentPersistence,
  getDocument,
  markDocumentPersisted,
  peekDocument,
  reconcileWorkspaceConnections,
  runDocumentMutation,
  YjsSessionAdmissionError,
} from '@/socket-server/yjs/upstream-utils'
import {
  applyDashboardLayoutStructureMutation,
  applyLayoutEditDocument,
  createDefaultDashboardWidgetDocument,
  type DashboardLayoutEditPlan,
  type DashboardLayoutProjectionContent,
  type DashboardLayoutStructureMutation,
  type DashboardLayoutTopologyNode,
  DashboardLayoutValidationError,
  findDashboardTopologyPanel,
  normalizeDashboardLayoutProjection,
} from '@/widgets/layout-document'
import { isPairColor, PAIR_COLORS } from '@/widgets/pair-colors'
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
const INTERNAL_YJS_DASHBOARD_EDIT_PATH = /^\/internal\/yjs\/dashboard-layouts\/([^/]+)\/edit$/
const INTERNAL_YJS_SNAPSHOT_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/snapshot$/
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
  workspaceId: string
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
      key !== 'workspaceId' &&
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
  if (typeof candidate.workspaceId !== 'string' || !candidate.workspaceId.trim()) {
    throw new InvalidInternalYjsRequestError('workspaceId is required')
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
    workspaceId: candidate.workspaceId.trim(),
    fields: candidate.fields as Record<string, any>,
    ...(expectedReviewBaseStateHash ? { expectedReviewBaseStateHash } : {}),
    ...(identity ? { identity } : {}),
  }
}

async function getBootstrappedApplyDocument(
  descriptor: ReturnType<typeof buildReviewTargetDescriptorFromEnvelope>
): Promise<Y.Doc> {
  const liveDoc = peekDocument(descriptor.yjsSessionId)
  if (liveDoc) {
    return getDocument(descriptor.yjsSessionId, true, undefined, descriptor.workspaceId).doc
  }

  if (!descriptor.entityId) {
    throw new InvalidInternalYjsRequestError('Saved Yjs session required')
  }

  const bootstrapped = await createSavedReviewTargetBootstrapUpdate(descriptor)
  if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
    throw new Error('Yjs review target is not active')
  }

  return getDocument(
    descriptor.yjsSessionId,
    true,
    bootstrapped.state,
    bootstrapped.descriptor.workspaceId
  ).doc
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
  const persistedGeneration = await flushDocumentPersistence(doc)
  const liveState = Y.encodeStateVector(doc)
  const staging = new Y.Doc()
  Y.applyUpdate(staging, Y.encodeStateAsUpdate(doc), YJS_ORIGINS.SYSTEM)
  try {
    mutate(staging)
    const persisted = await persist(staging)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(staging, liveState), YJS_ORIGINS.SYSTEM)
    markDocumentPersisted(doc, persistedGeneration)
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

async function applySavedEntityThroughStaging(input: {
  doc: Y.Doc
  entityId: string
  entityKind: SavedEntityKind
  workspaceId: string
  identity?: SavedEntityIdentityMutation
  validate?: (current: Y.Doc) => void
  mutate: (staged: Y.Doc) => void
}): Promise<Record<string, unknown>> {
  input.validate?.(input.doc)
  const persisted = await applyThroughStaging(input.doc, input.mutate, (staged) =>
    saveSavedEntityYjsDocToDb(
      input.entityKind,
      input.entityId,
      input.workspaceId,
      staged,
      input.identity ? { identity: input.identity } : undefined
    )
  )
  await refreshActiveEntityListSession(input.entityKind, input.workspaceId).catch(() => undefined)
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

    const envelope = parseYjsTransportEnvelope(Object.fromEntries(parsedUrl.searchParams))
    if (envelope.sessionId !== sessionId) {
      throw new InvalidInternalYjsRequestError('Session ID mismatch')
    }
    const descriptor = buildReviewTargetDescriptorFromEnvelope(envelope)
    const liveDoc = await refreshActiveEntityListSession(
      descriptor.entityKind as ReviewEntityKind,
      descriptor.workspaceId as string,
      descriptor.ownerUserId ?? null
    )
    if (!liveDoc) {
      sendJson(res, 200, { success: true, applied: false })
      return
    }
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
    const descriptor = buildSavedEntityDescriptor(body.entityKind, entityId, body.workspaceId)
    const doc = await getBootstrappedApplyDocument(descriptor)
    cleanupDoc = doc
    const persistedFields = await runDocumentMutation(doc, () =>
      applySavedEntityThroughStaging({
        doc,
        entityId,
        entityKind: body.entityKind,
        workspaceId: body.workspaceId,
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
            {
              entityKind: body.entityKind,
              payload:
                body.entityKind === 'mcp_server'
                  ? resolveMcpServerSecretPlaceholders(
                      normalizedFields,
                      getEntityFields(staged, body.entityKind)
                    )
                  : normalizedFields,
            },
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
      error instanceof InvalidInternalYjsRequestError ||
      error instanceof McpServerSecretPlaceholderError
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
  const deletionLeaseId = removedSessionIds.length > 0 ? randomUUID() : null
  if (deletionLeaseId) {
    await beginYjsSessionDeletion(deletionLeaseId, { sessionIds: removedSessionIds })
  }

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
      const scope = { workspaceId, ownerUserId }

      committed = await runDocumentMutation(layoutDoc, async () => {
        const panel = findDashboardTopologyPanel(
          readDashboardLayoutDocument(layoutDoc).layout,
          panelId
        )
        if (!panel?.widgetKey) throw new Error(`Dashboard panel ${panelId} has no widget`)
        const { identityId, widgetKey } = panel
        const widgetDescriptor = buildDashboardWidgetDescriptor({
          layoutId: entityId,
          identityId,
          workspaceId,
          ownerUserId,
        })
        const widgetDoc = await getBootstrappedApplyDocument(widgetDescriptor)
        try {
          return await runDocumentMutation(widgetDoc, async () => {
            const widget = readDashboardWidgetDocument(widgetDoc, widgetKey)
            const patch: WidgetConfigMutationPatch = { ...requestedPatch }
            if (patch.params !== undefined) {
              patch.params = preserveDashboardLayoutCredentialPlaceholders(
                patch.params,
                widget.params
              ) as Record<string, unknown> | null
            }
            const pairColor = isPairColor(requestedPatch.pairColor)
              ? requestedPatch.pairColor
              : requestedPatch.pairColor === undefined
                ? widget.pairColor
                : 'gray'
            const pairDescriptor =
              pairColor === 'gray'
                ? null
                : buildDashboardColorPairDescriptor({
                    layoutId: entityId,
                    color: pairColor,
                    workspaceId,
                    ownerUserId,
                  })
            const pairDoc = pairDescriptor
              ? await getBootstrappedApplyDocument(pairDescriptor)
              : null
            try {
              const applyLockedEdit = async () => {
                const current = await readDashboardProjectionFromLiveOwners({
                  layoutDoc,
                  layoutId: entityId,
                  workspaceId,
                  ownerUserId,
                })
                const planned = applyWidgetConfigMutation({
                  widgetKey,
                  widget,
                  colorPairs: current.colorPairs,
                  panelId,
                  patch,
                })
                assertAcceptedServerToolReviewBase(
                  { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
                  hashServerToolReviewBase(
                    buildDashboardWidgetReviewBase(
                      current,
                      panelId,
                      planned.reviewBase,
                      requestedPatch
                    )
                  )
                )
                const widgetChanged = planned.changedPaths.some((path) =>
                  path.startsWith('widget.')
                )
                const pairChange = planned.colorPairDiff[0]
                if (widgetChanged) {
                  await applyThroughStaging(
                    widgetDoc,
                    (staged) =>
                      applyDashboardWidgetDocumentDelta(
                        staged,
                        widgetKey,
                        widget,
                        planned.widgetDocument,
                        YJS_ORIGINS.SAVE
                      ),
                    (staged) =>
                      saveDashboardWidgetYjsDocToDb(widgetDescriptor.yjsSessionId, scope, staged)
                  )
                }
                if (pairChange && pairDoc && pairDescriptor) {
                  await applyThroughStaging(
                    pairDoc,
                    (staged) =>
                      applyDashboardColorPairDocumentDelta(
                        staged,
                        pairChange.before,
                        pairChange.after,
                        YJS_ORIGINS.SAVE
                      ),
                    (staged) =>
                      saveDashboardColorPairYjsDocToDb(pairDescriptor.yjsSessionId, scope, staged)
                  )
                }
                return {
                  ...current,
                  widgets: { ...current.widgets, [identityId]: planned.widgetDocument },
                  colorPairs: planned.colorPairs,
                }
              }

              return pairDoc
                ? await runDocumentMutation(pairDoc, applyLockedEdit)
                : await applyLockedEdit()
            } finally {
              if (pairDoc) discardDocumentIfIdle(pairDoc)
            }
          })
        } finally {
          discardDocumentIfIdle(widgetDoc)
        }
      })
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
        : error instanceof SavedEntityPersistenceError ||
            error instanceof DashboardLayoutOperationError
          ? error.status
          : error instanceof DashboardLayoutValidationError
            ? 400
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
    const submittedUpdate = Buffer.from(updateBase64, 'base64')
    try {
      Y.decodeUpdate(submittedUpdate)
    } catch {
      throw new InvalidInternalYjsRequestError('updateBase64 is invalid')
    }
    const identity = parseSavedEntityIdentityMutation(body.identity)
    if (identity && (entityKind === 'dashboard_widget' || entityKind === 'dashboard_color_pair')) {
      throw new InvalidInternalYjsRequestError('Dashboard document identity is not saved here')
    }
    const doc = await getBootstrappedApplyDocument(descriptor)
    cleanupDoc = doc
    await runDocumentMutation(doc, async () => {
      if (!descriptor.entityId || entityKind === 'workflow') return
      if (entityKind === 'dashboard_widget' || entityKind === 'dashboard_color_pair') {
        if (!descriptor.workspaceId || !descriptor.ownerUserId) {
          throw new InvalidInternalYjsRequestError('Dashboard child owner scope is required')
        }
        const scope = { workspaceId: descriptor.workspaceId, ownerUserId: descriptor.ownerUserId }
        await applyThroughStaging(
          doc,
          (staged) => Y.applyUpdate(staged, submittedUpdate, YJS_ORIGINS.SAVE),
          (staged) =>
            (entityKind === 'dashboard_widget'
              ? saveDashboardWidgetYjsDocToDb
              : saveDashboardColorPairYjsDocToDb)(descriptor.yjsSessionId, scope, staged)
        )
        return
      }

      if (!descriptor.workspaceId) {
        throw new InvalidInternalYjsRequestError('Saved entity workspace is required')
      }
      await applySavedEntityThroughStaging({
        doc,
        entityId: descriptor.entityId,
        entityKind,
        workspaceId: descriptor.workspaceId,
        identity,
        mutate: (staged) => {
          Y.applyUpdate(staged, submittedUpdate, YJS_ORIGINS.SAVE)
        },
      })
    })

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
  if (isEntityListSessionId(descriptor.yjsSessionId)) {
    sendJson(res, 400, { error: 'Entity-list snapshots are not supported', sessionId })
    return
  }

  try {
    const liveDoc = peekDocument(sessionId)
    if (liveDoc) {
      const activeDoc = getDocument(sessionId, true, undefined, descriptor.workspaceId).doc
      sendJson(res, 200, {
        snapshotBase64: Buffer.from(Y.encodeStateAsUpdate(activeDoc)).toString('base64'),
        descriptor,
        runtime: getReviewTargetRuntimeState(activeDoc),
        touchedAt: null,
      })
      return
    }

    const bootstrapped = descriptor.entityId
      ? await createSavedReviewTargetBootstrapUpdate(descriptor)
      : null
    if (!bootstrapped) {
      sendJson(res, 404, { error: 'Session not found', sessionId })
      return
    }
    if (!bootstrapped.runtime || bootstrapped.runtime.docState !== 'active') {
      sendJson(res, 410, { error: 'Session expired', sessionId })
      return
    }

    sendJson(res, 200, {
      snapshotBase64: Buffer.from(bootstrapped.state).toString('base64'),
      descriptor: bootstrapped.descriptor,
      runtime: bootstrapped.runtime,
      touchedAt: null,
    })
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    const status = Number((error as { status?: unknown }).status) || 500
    sendJson(res, status, {
      error: error instanceof Error ? error.message : 'Failed to get snapshot',
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
    const { leaseId, sessionIds, workspaceIds } = raw as Record<string, unknown>
    if (typeof leaseId !== 'string' || !leaseId.trim()) {
      throw new InvalidInternalYjsRequestError('leaseId is required')
    }
    const targets = [sessionIds, workspaceIds]
    if (
      targets.some(
        (ids) =>
          ids !== undefined &&
          (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id.trim()))
      ) ||
      targets.every((ids) => !Array.isArray(ids) || ids.length === 0)
    ) {
      throw new InvalidInternalYjsRequestError(
        'sessionIds or workspaceIds must contain a non-empty string ID'
      )
    }
    await beginYjsSessionDeletion(leaseId, {
      sessionIds: sessionIds as string[] | undefined,
      workspaceIds: workspaceIds as string[] | undefined,
    })
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

function handleInternalYjsDeletionCommitRequest(res: ServerResponse, leaseId: string): void {
  commitYjsSessionDeletion(leaseId)
  sendJson(res, 200, { success: true })
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
    handleInternalYjsDeletionCommitRequest(res, commitDeletionLeaseId)
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
