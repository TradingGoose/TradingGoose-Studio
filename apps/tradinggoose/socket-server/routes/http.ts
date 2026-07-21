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
import {
  INTERNAL_YJS_ACTOR_HEADER,
  type ReviewEntityKind,
} from '@/lib/copilot/review-sessions/types'
import {
  buildCopilotServerToolErrorResponse,
  StructuredServerToolError,
} from '@/lib/copilot/server-tool-errors'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
} from '@/lib/copilot/tools/server/base-tool'
import { commitDashboardLayoutStructure } from '@/lib/dashboard-layouts/operations'
import { preserveDashboardLayoutCredentialPlaceholders } from '@/lib/dashboard-layouts/read-projection'
import {
  buildDashboardLayoutReviewBase,
  buildDashboardWidgetReviewBase,
  requireDashboardWidgetPanel,
} from '@/lib/dashboard-layouts/review-base'
import { env } from '@/lib/env'
import type { SavedEntityIdentityMutation } from '@/lib/saved-entities/identity'
import { saveWorkflowYjsDocToDb } from '@/lib/workflows/db-helpers'
import {
  applyDashboardColorPairDocumentDelta,
  applyDashboardWidgetDocumentDelta,
  readDashboardLayoutDocument,
  readDashboardWidgetDocument,
  setDashboardLayoutTopology,
} from '@/lib/yjs/dashboard-layout-session'
import { getEntityFields, seedEntitySession } from '@/lib/yjs/entity-session'
import { SavedEntityPersistenceError } from '@/lib/yjs/entity-state'
import {
  saveDashboardYjsDocsToDb,
  saveSavedEntityYjsDocToDb,
} from '@/lib/yjs/server/apply-entity-state'
import {
  assembleDashboardLayoutProjection,
  initializeSavedReviewTargetDocument,
} from '@/lib/yjs/server/bootstrap-review-target'
import {
  runYjsRevocationTransaction,
  type YjsRevocationTransaction,
} from '@/lib/yjs/server/revocation-fence'
import { YJS_ORIGINS } from '@/lib/yjs/transaction-origins'
import { replaceWorkflowDocumentState, type WorkflowSnapshot } from '@/lib/yjs/workflow-session'
import { replaceWorkflowVariables } from '@/lib/yjs/workflow-variables'
import { getMonitorRuntimeLockHealth } from '@/socket-server/monitor-runtime-lock'
import { refreshActiveEntityListSession } from '@/socket-server/yjs/entity-list-session'
import {
  acquireDocument,
  drainYjsSessionTargets,
  persistStagedDocuments,
} from '@/socket-server/yjs/upstream-utils'
import {
  applyDashboardLayoutStructureMutation,
  applyLayoutEditDocument,
  createDefaultDashboardWidgetDocument,
  type DashboardLayoutEditPlan,
  type DashboardLayoutProjectionContent,
  DashboardLayoutValidationError,
  normalizeDashboardLayoutStructureMutation,
} from '@/widgets/layout-document'
import { isPairColor } from '@/widgets/pair-colors'
import {
  applyWidgetConfigMutation,
  isWidgetConfigValidationError,
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
const INTERNAL_YJS_DRAIN_PATH = '/internal/yjs/session-drains'
const INTERNAL_YJS_ENTITY_LIST_MEMBERS_PATH = /^\/internal\/yjs\/sessions\/([^/]+)\/members$/

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

function getYjsRequestErrorStatus(error: unknown): number {
  if (
    error instanceof InvalidInternalYjsRequestError ||
    error instanceof McpServerSecretPlaceholderError
  ) {
    return 400
  }
  const status = error instanceof Error && 'status' in error ? Number(error.status) : 500
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500
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

function requireInternalActorUserId(req: IncomingMessage): string {
  const actorUserId = req.headers[INTERNAL_YJS_ACTOR_HEADER]
  if (typeof actorUserId !== 'string' || !actorUserId.trim()) {
    throw new InvalidInternalYjsRequestError('Acting user is required')
  }
  return actorUserId.trim()
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function sendYjsRequestError(res: ServerResponse, error: unknown, fallback: string): void {
  if (
    error instanceof StructuredServerToolError ||
    error instanceof DashboardLayoutValidationError ||
    isWidgetConfigValidationError(error)
  ) {
    const response = buildCopilotServerToolErrorResponse(undefined, error)
    sendJson(res, response.status, response.body)
    return
  }
  sendJson(
    res,
    getYjsRequestErrorStatus(error),
    error instanceof SavedEntityPersistenceError
      ? error.responseBody()
      : { error: error instanceof Error ? error.message : fallback }
  )
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

function withBootstrappedDocument<T>(
  descriptor: ReturnType<typeof buildReviewTargetDescriptorFromEnvelope>,
  actorUserId: string | null,
  use: (doc: Y.Doc) => Promise<T> | T
): Promise<T> {
  if (!descriptor.entityId) {
    throw new InvalidInternalYjsRequestError('Saved Yjs session required')
  }
  return acquireDocument(
    descriptor.yjsSessionId,
    {
      workspaceId: descriptor.workspaceId,
      ...(actorUserId
        ? { admission: { userId: actorUserId, accessMode: 'write' as const, descriptor } }
        : {}),
      initialize: (_doc, admission, readStore) =>
        initializeSavedReviewTargetDocument(admission?.descriptor ?? descriptor, readStore),
    },
    use
  )
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
  const persisted = await persistStagedDocuments(
    [{ doc: input.doc, mutate: input.mutate }],
    ([staged]) =>
      saveSavedEntityYjsDocToDb(
        input.entityKind,
        input.entityId,
        input.workspaceId,
        staged!,
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
    sendJson(res, 200, { success: true, applied: liveDoc !== null })
  } catch (error) {
    logger.error('Error applying entity-list members', { error, sessionId })
    sendYjsRequestError(res, error, 'Failed to apply entity-list members')
  }
}

async function handleInternalYjsWorkflowApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  workflowId: string
): Promise<void> {
  try {
    const actorUserId = requireInternalActorUserId(req)
    const body = parseApplyWorkflowStateRequest(await readJsonBody(req))
    const descriptor = buildSavedEntityDescriptor('workflow', workflowId, null)
    await withBootstrappedDocument(descriptor, actorUserId, (doc) =>
      persistStagedDocuments(
        [{ doc, mutate: (target) => applyWorkflowApplyRequest(target, body) }],
        ([staged]) => saveWorkflowYjsDocToDb(workflowId, staged!)
      )
    )
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Error applying workflow state', { error, workflowId })
    sendYjsRequestError(res, error, 'Failed to apply workflow state')
  }
}

async function handleInternalYjsEntityApplyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  try {
    const actorUserId = requireInternalActorUserId(req)
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
    const persistedFields = await withBootstrappedDocument(descriptor, actorUserId, (doc) =>
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
    sendYjsRequestError(res, error, 'Failed to apply entity state')
  }
}

async function readDashboardProjectionFromLiveOwners(input: {
  layoutDoc: Y.Doc
  layoutId: string
  workspaceId: string
  ownerUserId: string
  heldDocs?: ReadonlyMap<string, Y.Doc>
}): Promise<DashboardLayoutProjectionContent> {
  return assembleDashboardLayoutProjection({
    document: readDashboardLayoutDocument(input.layoutDoc),
    layoutId: input.layoutId,
    workspaceId: input.workspaceId,
    ownerUserId: input.ownerUserId,
    readOwnerDocument: (descriptor, read) => {
      const held = input.heldDocs?.get(descriptor.yjsSessionId)
      return held
        ? Promise.resolve(read(held))
        : withBootstrappedDocument(descriptor, input.ownerUserId, read)
    },
  })
}

async function commitDashboardStructurePlan(input: {
  layoutDoc: Y.Doc
  layoutId: string
  workspaceId: string
  ownerUserId: string
  plan: DashboardLayoutEditPlan
}): Promise<void> {
  const createdWidgets = await Promise.all(
    input.plan.createdBindings.map(async (binding) => ({
      binding,
      document: binding.sourceIdentityId
        ? await withBootstrappedDocument(
            buildDashboardWidgetDescriptor({
              layoutId: input.layoutId,
              identityId: binding.sourceIdentityId,
              workspaceId: input.workspaceId,
              ownerUserId: input.ownerUserId,
            }),
            input.ownerUserId,
            (doc) => readDashboardWidgetDocument(doc, binding.widgetKey)
          )
        : createDefaultDashboardWidgetDocument(binding.widgetKey),
    }))
  )
  const removedSessionIds = input.plan.removedIdentityIds.map(
    (identityId) =>
      buildDashboardWidgetDescriptor({
        layoutId: input.layoutId,
        identityId,
        workspaceId: input.workspaceId,
        ownerUserId: input.ownerUserId,
      }).yjsSessionId
  )
  await persistStagedDocuments(
    [
      {
        doc: input.layoutDoc,
        mutate: (staged) => setDashboardLayoutTopology(staged, input.plan.layout),
      },
    ],
    async ([staged]) => {
      const commit = (tx?: YjsRevocationTransaction) =>
        commitDashboardLayoutStructure(
          { workspaceId: input.workspaceId, ownerUserId: input.ownerUserId },
          input.layoutId,
          {
            layout: readDashboardLayoutDocument(staged!).layout,
            createdWidgets,
            removedIdentityIds: input.plan.removedIdentityIds,
          },
          tx
        )
      if (removedSessionIds.length === 0) return commit()
      return runYjsRevocationTransaction(
        { sessionIds: removedSessionIds },
        drainYjsSessionTargets,
        (tx) => commit(tx)
      )
    }
  )
  await refreshActiveEntityListSession(
    'dashboard_layout',
    input.workspaceId,
    input.ownerUserId
  ).catch(() => undefined)
}

async function handleInternalDashboardEditRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger,
  entityId: string
): Promise<void> {
  try {
    const actorUserId = requireInternalActorUserId(req)
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
    const committed = await withBootstrappedDocument(descriptor, actorUserId, async (layoutDoc) => {
      if (body.mutation === 'layout') {
        if (typeof body.entityDocument !== 'string') {
          throw new InvalidInternalYjsRequestError('entityDocument is required')
        }
        const removedPanelIds = Array.isArray(body.removedPanelIds)
          ? body.removedPanelIds.filter((value): value is string => typeof value === 'string')
          : []
        const current = readDashboardLayoutDocument(layoutDoc)
        const plan = applyLayoutEditDocument(current, body.entityDocument, removedPanelIds)
        assertAcceptedServerToolReviewBase(
          { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
          hashServerToolReviewBase(buildDashboardLayoutReviewBase(current, plan))
        )
        await commitDashboardStructurePlan({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
          plan,
        })
        return readDashboardProjectionFromLiveOwners({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
        })
      }
      if (body.mutation === 'structure') {
        const structure = normalizeDashboardLayoutStructureMutation(body.structure)
        const current = readDashboardLayoutDocument(layoutDoc)
        const plan = applyDashboardLayoutStructureMutation(current.layout, structure)
        await commitDashboardStructurePlan({
          layoutDoc,
          layoutId: entityId,
          workspaceId,
          ownerUserId,
          plan,
        })
        return
      }
      if (body.mutation === 'widget') {
        const panelId = typeof body.panelId === 'string' ? body.panelId.trim() : ''
        if (
          !panelId ||
          !body.patch ||
          typeof body.patch !== 'object' ||
          Array.isArray(body.patch)
        ) {
          throw new InvalidInternalYjsRequestError('panelId and patch are required')
        }
        const requestedPatch = body.patch as WidgetConfigMutationPatch
        const scope = { workspaceId, ownerUserId }
        const panel = requireDashboardWidgetPanel(
          readDashboardLayoutDocument(layoutDoc).layout,
          panelId
        )
        const { identityId, widgetKey } = panel
        const widgetDescriptor = buildDashboardWidgetDescriptor({
          layoutId: entityId,
          identityId,
          workspaceId,
          ownerUserId,
        })
        return withBootstrappedDocument(widgetDescriptor, actorUserId, async (widgetDoc) => {
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
          const applyLockedEdit = async (pairDoc: Y.Doc | null) => {
            const heldDocs = new Map<string, Y.Doc>([[widgetDescriptor.yjsSessionId, widgetDoc]])
            if (pairDescriptor && pairDoc) heldDocs.set(pairDescriptor.yjsSessionId, pairDoc)
            const current = await readDashboardProjectionFromLiveOwners({
              layoutDoc,
              layoutId: entityId,
              workspaceId,
              ownerUserId,
              heldDocs,
            })
            const planned = applyWidgetConfigMutation({
              origin: 'copilot',
              widgetKey,
              widget,
              colorPairs: current.colorPairs,
              panelId,
              patch,
            })
            assertAcceptedServerToolReviewBase(
              { userId: ownerUserId, acceptedReviewBaseStateHash: expectedReviewBaseStateHash },
              hashServerToolReviewBase(
                buildDashboardWidgetReviewBase(current, panelId, planned.reviewBase, requestedPatch)
              )
            )
            const widgetChanged = planned.changedPaths.some((path) => path.startsWith('widget.'))
            const pairChange = planned.colorPairDiff[0]
            const targets: Array<{
              part: 'widget' | 'colorPair'
              sessionId: string
              doc: Y.Doc
              mutate: (staged: Y.Doc) => void
            }> = []
            if (widgetChanged) {
              targets.push({
                part: 'widget',
                sessionId: widgetDescriptor.yjsSessionId,
                doc: widgetDoc,
                mutate: (staged) =>
                  applyDashboardWidgetDocumentDelta(
                    staged,
                    widgetKey,
                    widget,
                    planned.widgetDocument,
                    YJS_ORIGINS.SAVE
                  ),
              })
            }
            if (pairChange && pairDoc && pairDescriptor) {
              targets.push({
                part: 'colorPair',
                sessionId: pairDescriptor.yjsSessionId,
                doc: pairDoc,
                mutate: (staged) =>
                  applyDashboardColorPairDocumentDelta(
                    staged,
                    pairChange.before,
                    pairChange.after,
                    YJS_ORIGINS.SAVE
                  ),
              })
            }
            if (targets.length > 0) {
              await persistStagedDocuments(targets, (staged) =>
                saveDashboardYjsDocsToDb(
                  scope,
                  Object.fromEntries(
                    targets.map((target, index) => [
                      target.part,
                      { sessionId: target.sessionId, doc: staged[index]! },
                    ])
                  ) as Parameters<typeof saveDashboardYjsDocsToDb>[1]
                )
              )
            }
            return {
              ...current,
              widgets: { ...current.widgets, [identityId]: planned.widgetDocument },
              colorPairs: planned.colorPairs,
            }
          }

          return pairDescriptor
            ? withBootstrappedDocument(pairDescriptor, actorUserId, applyLockedEdit)
            : applyLockedEdit(null)
        })
      }
      throw new InvalidInternalYjsRequestError('Unknown dashboard mutation')
    })
    sendJson(res, 200, { success: true, content: committed })
  } catch (error) {
    logger.error('Error applying dashboard edit', { error, entityId })
    sendYjsRequestError(res, error, 'Failed to apply dashboard edit')
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
    const snapshot = await withBootstrappedDocument(descriptor, null, (doc) => ({
      snapshotBase64: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
      descriptor,
      runtime: getReviewTargetRuntimeState(doc),
      touchedAt: null,
    }))
    sendJson(res, 200, snapshot)
  } catch (error) {
    logger.error('Error getting Yjs snapshot', { error, path: parsedUrl.pathname })
    sendYjsRequestError(res, error, 'Failed to get snapshot')
  }
}

async function handleInternalYjsDrainRequest(
  req: IncomingMessage,
  res: ServerResponse,
  logger: Logger
): Promise<void> {
  try {
    const raw = await readJsonBody(req)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new InvalidInternalYjsRequestError('Invalid Yjs drain target body')
    }
    const { sessionIds, workspaceIds } = raw as Record<string, unknown>
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
    await drainYjsSessionTargets({
      sessionIds: sessionIds as string[] | undefined,
      workspaceIds: workspaceIds as string[] | undefined,
    })
    sendJson(res, 200, { success: true })
  } catch (error) {
    logger.error('Failed to drain Yjs session targets', { error })
    sendYjsRequestError(res, error, 'Failed to drain Yjs session targets')
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

  if (req.method === 'POST' && parsedUrl.pathname === INTERNAL_YJS_DRAIN_PATH) {
    await handleInternalYjsDrainRequest(req, res, logger)
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
