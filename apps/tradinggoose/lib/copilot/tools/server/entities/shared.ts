import {
  type EntityDocumentKind,
  getEntityDocumentFormat,
  getEntityDocumentName,
  parseEntityDocument,
  serializeEntityDocument,
} from '@/lib/copilot/entity-documents'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  assertAcceptedServerToolReviewBase,
  hashServerToolReviewBase,
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import { readEntityListMembersFromDb } from '@/lib/yjs/server/entity-loaders'

type SavedEntityDocumentKind = EntityDocumentKind
export type EntityDocumentArgs = {
  entityId?: string
  runtimeId?: string
  workspaceId?: string
  entityDocument?: string
  documentFormat?: string
}

/**
 * Canonical list_* entry. A list is a discovery surface — "what exists" — plus
 * the minimum state needed to know whether a listed item is usable.
 * Owner-scoped lists (dashboard layouts) additionally carry ordering/lifecycle
 * metadata because their list contract requires it.
 */
type EntityListEntry = {
  entityId: string
  entityName: string
  entityDescription?: string
  enabled?: boolean
  color?: string
  connectionStatus?: string
  sortOrder?: number
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}

export type CopilotIndicatorListEntry = {
  name: string
  source: 'default' | 'custom'
  editable: boolean
  callableInFunctionBlock: boolean
  inputTitles?: string[]
  entityId?: string
  runtimeId?: string
}

export type EntityCreateResult = {
  entityId: string
  fields: Record<string, unknown>
}

type CreateEntityFromDocument = (
  fields: Record<string, unknown>,
  context: ServerToolExecutionContext | undefined
) => Promise<EntityCreateResult>

type ApplyEntityDocument = (input: {
  entityId: string
  fields: Record<string, unknown>
  workspaceId: string
}) => Promise<Record<string, unknown>>

type PrepareEntityDocumentFields = (
  fields: Record<string, unknown>
) => Record<string, unknown>

const ENTITY_KIND_LABELS: Record<SavedEntityDocumentKind, string> = {
  skill: 'skill',
  custom_tool: 'custom tool',
  indicator: 'indicator',
  knowledge_base: 'knowledge base',
  mcp_server: 'MCP server',
  watchlist: 'watchlist',
  dashboard_layout: 'dashboard layout',
}

export function requireUserId(context?: ServerToolExecutionContext): string {
  const userId = context?.userId?.trim()
  if (!userId) {
    throw new Error('Authenticated user is required to execute copilot entity tools')
  }
  return userId
}

function requireWorkspaceId(context?: ServerToolExecutionContext): string {
  const workspaceId = context?.workspaceId?.trim()
  if (!workspaceId) {
    throw new Error(
      'No active workspace found in execution context. Ensure workspaceId is included in tool provenance.'
    )
  }
  return workspaceId
}

export async function verifyWorkspaceContext(
  context: ServerToolExecutionContext | undefined,
  accessMode: 'read' | 'write'
): Promise<{ userId: string; workspaceId: string }> {
  const userId = requireUserId(context)
  const workspaceId = requireWorkspaceId(context)
  const access = await checkWorkspaceAccess(workspaceId, userId)

  if (!access.exists || !access.hasAccess || (accessMode === 'write' && !access.canWrite)) {
    throw new Error('Access denied: You do not have permission to use this workspace')
  }

  return { userId, workspaceId }
}

export async function verifySavedEntityContext(
  context: ServerToolExecutionContext | undefined,
  entityKind: SavedEntityDocumentKind,
  entityId: string,
  accessMode: 'read' | 'write'
): Promise<{ userId: string; workspaceId: string; ownerUserId: string | null }> {
  const userId = requireUserId(context)
  // Dashboard layouts are owner-scoped saved entities: the descriptor carries the
  // authenticated user as owner and access verification enforces row ownership.
  // Shared entity kinds keep a null owner scope.
  const ownerUserId = entityKind === 'dashboard_layout' ? userId : null
  const access = await verifyReviewTargetAccess(
    userId,
    buildSavedEntityDescriptor(entityKind, entityId, context?.workspaceId?.trim() ?? null, {
      ownerUserId,
    }),
    accessMode
  )

  if (!access.hasAccess || !access.workspaceId) {
    throw new Error(
      `Access denied: You do not have permission to ${accessMode === 'write' ? 'edit' : 'read'} this ${ENTITY_KIND_LABELS[entityKind]}`
    )
  }

  return { userId, workspaceId: access.workspaceId, ownerUserId }
}

export function requireEntityId(args: EntityDocumentArgs, toolName: string): string {
  const entityId = args.entityId?.trim()
  if (!entityId) {
    throw new Error(`entityId is required for ${toolName}`)
  }
  return entityId
}

function parseEntityMutationDocument(
  kind: SavedEntityDocumentKind,
  args: EntityDocumentArgs
): Record<string, unknown> {
  const entityDocument = args.entityDocument?.trim()
  if (!entityDocument) {
    throw new Error('entityDocument is required')
  }

  const expectedFormat = getEntityDocumentFormat(kind)
  if (args.documentFormat && args.documentFormat !== expectedFormat) {
    throw new Error(
      `Unsupported documentFormat "${args.documentFormat}". Expected ${expectedFormat}`
    )
  }

  return parseEntityDocument(kind, entityDocument)
}

export function buildDocumentEnvelope(
  kind: SavedEntityDocumentKind,
  entityId: string | undefined,
  fields: Record<string, unknown>
) {
  return {
    entityKind: kind,
    ...(entityId ? { entityId } : {}),
    entityName: getEntityDocumentName(kind, fields),
    documentFormat: getEntityDocumentFormat(kind),
    entityDocument: serializeEntityDocument(kind, fields),
  }
}

export function buildReviewDocumentDiff(
  kind: SavedEntityDocumentKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return {
    before: serializeEntityDocument(kind, before),
    after: serializeEntityDocument(kind, after),
  }
}

export async function readSavedEntityDocumentFields(
  kind: SavedEntityDocumentKind,
  entityId: string,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<Record<string, unknown>> {
  if (ownerUserId === undefined) {
    return readBootstrappedSavedEntityFields(kind as SavedEntityKind, entityId, workspaceId)
  }
  return readBootstrappedSavedEntityFields(
    kind as SavedEntityKind,
    entityId,
    workspaceId,
    ownerUserId
  )
}

/**
 * Canonical read for every server-side saved-entity list_* tool: the workspace's
 * active rows. Live Yjs list sessions are the browser realtime projection; server
 * tools must not return a stale projection when that session is degraded.
 *
 * Owner-scoped lists (dashboard layouts) pass the authenticated user as
 * `ownerUserId` and receive the owner list contract's ordering/lifecycle
 * metadata. Shared entity kinds omit the owner scope and keep their entry
 * shape unchanged.
 */
export async function buildSavedEntityListInfo(
  entityKind: SavedEntityKind,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<EntityListEntry[]> {
  const members =
    ownerUserId === undefined
      ? await readEntityListMembersFromDb(entityKind, workspaceId)
      : await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId)
  const includeOwnerListMetadata = ownerUserId != null
  return members.map((member) => ({
    entityId: member.id,
    entityName: member.name,
    ...(typeof member.description === 'string' ? { entityDescription: member.description } : {}),
    ...(typeof member.enabled === 'boolean' ? { enabled: member.enabled } : {}),
    ...(typeof member.color === 'string' ? { color: member.color } : {}),
    ...(typeof member.connectionStatus === 'string'
      ? { connectionStatus: member.connectionStatus }
      : {}),
    ...(includeOwnerListMetadata && typeof member.sortOrder === 'number'
      ? { sortOrder: member.sortOrder }
      : {}),
    ...(includeOwnerListMetadata && typeof member.isActive === 'boolean'
      ? { isActive: member.isActive }
      : {}),
    ...(includeOwnerListMetadata && typeof member.createdAt === 'string'
      ? { createdAt: member.createdAt }
      : {}),
    ...(includeOwnerListMetadata && typeof member.updatedAt === 'string'
      ? { updatedAt: member.updatedAt }
      : {}),
  }))
}

async function hashCreateEntityReviewBase(
  kind: SavedEntityDocumentKind,
  workspaceId: string
): Promise<string> {
  return hashServerToolReviewBase({
    kind,
    workspaceId,
    entities: await buildSavedEntityListInfo(kind as SavedEntityKind, workspaceId),
  })
}

export async function executeCreateEntityDocumentMutation(
  kind: SavedEntityDocumentKind,
  args: EntityDocumentArgs,
  context: ServerToolExecutionContext | undefined,
  create: CreateEntityFromDocument,
  prepareFields?: PrepareEntityDocumentFields
) {
  if (args.entityId?.trim()) {
    throw new Error(`create_${kind} does not accept entityId`)
  }

  const scopedContext = withWorkspaceArgContext(context, args)
  const { workspaceId } = await verifyWorkspaceContext(scopedContext, 'write')
  const parsedFields = parseEntityMutationDocument(kind, args)
  const fields = prepareFields ? prepareFields(parsedFields) : parsedFields

  if (shouldStageServerToolMutationForReview(context)) {
    return {
      requiresReview: true,
      success: true,
      workspaceId,
      reviewBaseStateHash: await hashCreateEntityReviewBase(kind, workspaceId),
      ...buildDocumentEnvelope(kind, undefined, fields),
      preview: {
        documentDiff: {
          before: '',
          after: serializeEntityDocument(kind, fields),
        },
      },
    }
  }

  if (context?.acceptedReviewBaseStateHash) {
    assertAcceptedServerToolReviewBase(context, await hashCreateEntityReviewBase(kind, workspaceId))
  }
  const created = await create(fields, scopedContext)
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, created.entityId, created.fields),
  }
}

export async function executeUpdateEntityDocumentMutation(
  kind: SavedEntityDocumentKind,
  toolName: string,
  args: EntityDocumentArgs,
  context: ServerToolExecutionContext | undefined,
  apply?: ApplyEntityDocument,
  prepareFields?: PrepareEntityDocumentFields
) {
  const parsedFields = parseEntityMutationDocument(kind, args)
  const fields = prepareFields ? prepareFields(parsedFields) : parsedFields
  const entityId = requireEntityId(args, toolName)
  const { workspaceId } = await verifySavedEntityContext(context, kind, entityId, 'write')

  if (shouldStageServerToolMutationForReview(context)) {
    const currentFields = await readSavedEntityDocumentFields(kind, entityId, workspaceId)
    return {
      requiresReview: true,
      success: true,
      reviewBaseStateHash: hashServerToolReviewBase(currentFields),
      ...buildDocumentEnvelope(kind, entityId, fields),
      preview: {
        documentDiff: buildReviewDocumentDiff(kind, currentFields, fields),
      },
    }
  }

  if (context?.acceptedReviewBaseStateHash) {
    assertAcceptedServerToolReviewBase(
      context,
      hashServerToolReviewBase(await readSavedEntityDocumentFields(kind, entityId, workspaceId))
    )
  }

  const persistedFields = apply
    ? await apply({ entityId, fields, workspaceId })
    : await applySavedEntityState(kind, entityId, fields)
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, entityId, persistedFields),
  }
}

export type EntityServerTool<TArgs = EntityDocumentArgs> = BaseServerTool<TArgs, any>
