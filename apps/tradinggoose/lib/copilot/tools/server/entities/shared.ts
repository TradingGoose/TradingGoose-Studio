import {
  type EntityDocumentKind,
  getEntityDocumentFormat,
  parseEntityDocument,
  resolveMcpServerSecretPlaceholders,
  serializeEntityDocument,
} from '@/lib/copilot/entity-documents'
import { buildSavedEntityDescriptor } from '@/lib/copilot/review-sessions/identity'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { StructuredServerToolError } from '@/lib/copilot/server-tool-errors'
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
import {
  checkWorkspaceAccess,
  getWorkspaceById,
  type WorkspaceRecord,
} from '@/lib/permissions/utils'
import {
  normalizeSavedEntityIdentity,
  renameSavedEntityIdentity,
  SavedEntityIdentityError,
} from '@/lib/saved-entities/identity'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'
import {
  type EntityListBeforeInsert,
  type EntityListReadStore,
  readEntityListMembersFromDb,
} from '@/lib/yjs/server/entity-loaders'

type SavedEntityDocumentKind = EntityDocumentKind
type GenericSavedEntityDocumentKind = Exclude<SavedEntityDocumentKind, 'dashboard_layout'>

const accessDenied = (message: string) =>
  new StructuredServerToolError({
    status: 403,
    body: { code: 'access_denied', error: message, retryable: false },
  })

export type EntityDocumentArgs = {
  entityId?: string
  runtimeId?: string
  workspaceId?: string
  name?: string
  entityDocument?: string
  documentFormat?: string
}

export type RenameEntityArgs = {
  entityId: string
  name: string
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
  entityName: string
  fields: Record<string, unknown>
}
export type EntityCreateContext = ServerToolExecutionContext & {
  workspaceId: string
  beforeInsert?: EntityListBeforeInsert
}

type CreateEntityFromDocument = (
  name: string,
  fields: Record<string, unknown>,
  context: EntityCreateContext
) => Promise<EntityCreateResult>

type EntityCreateReviewBase = (workspaceId: string, store?: EntityListReadStore) => Promise<string>

const ENTITY_KIND_LABELS: Record<ReviewEntityKind, string> = {
  workflow: 'workflow',
  skill: 'skill',
  custom_tool: 'custom tool',
  indicator: 'indicator',
  knowledge_base: 'knowledge base',
  mcp_server: 'MCP server',
  watchlist: 'watchlist',
  dashboard_layout: 'dashboard layout',
}

async function assertWorkspaceApiKeyPolicy(
  context: ServerToolExecutionContext | undefined,
  workspace: WorkspaceRecord | string | null | undefined
): Promise<void> {
  if (context?.apiKeyType !== 'personal' || !workspace) return
  const record = typeof workspace === 'string' ? await getWorkspaceById(workspace) : workspace
  if (record?.allowPersonalApiKeys) return

  throw new StructuredServerToolError({
    status: 403,
    body: {
      code: 'personal_api_keys_disabled',
      error: 'This workspace does not allow personal API keys.',
    },
  })
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
    throw accessDenied('Access denied: You do not have permission to use this workspace')
  }
  await assertWorkspaceApiKeyPolicy(context, access.workspace)
  return { userId, workspaceId }
}

export async function verifySavedEntityContext(
  context: ServerToolExecutionContext | undefined,
  entityKind: ReviewEntityKind,
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
    throw accessDenied(
      `Access denied: You do not have permission to ${accessMode === 'write' ? 'edit' : 'read'} this ${ENTITY_KIND_LABELS[entityKind]}`
    )
  }
  await assertWorkspaceApiKeyPolicy(context, access.workspaceId)

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

  try {
    return parseEntityDocument(kind, entityDocument)
  } catch (error) {
    if (
      kind !== 'watchlist' ||
      !(error instanceof WatchlistDocumentError) ||
      (error.status !== 400 && error.status !== 409)
    ) {
      throw error
    }
    throw new StructuredServerToolError({
      status: error.status,
      body: {
        code: 'invalid_watchlist_document',
        error: error.message,
        hint: 'For edits, start from read_watchlist, then send a complete tg-watchlist-document-v1. Use canonical listing identities from search_listing, keep item ids unique, keep each listing identity unique within its parent, and set listing parentId only to a section id.',
        retryable: true,
        issues: [{ path: 'entityDocument', message: error.message }],
      },
    })
  }
}

export function buildDocumentEnvelope(
  kind: SavedEntityDocumentKind,
  entityId: string | undefined,
  entityName: string,
  fields: Record<string, unknown>
) {
  return {
    entityKind: kind,
    ...(entityId ? { entityId } : {}),
    entityName,
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

async function readSavedEntityName(
  kind: ReviewEntityKind,
  entityId: string,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<string> {
  const members = await readEntityListMembersFromDb(kind, workspaceId, ownerUserId)
  const entityName = members.find((member) => member.id === entityId)?.name
  if (entityName === undefined) throw new Error(`${ENTITY_KIND_LABELS[kind]} not found`)
  return entityName
}

export async function readSavedEntityDocument(
  kind: GenericSavedEntityDocumentKind,
  entityId: string,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<{ entityName: string; fields: Record<string, unknown> }> {
  const [fields, entityName] = await Promise.all([
    readBootstrappedSavedEntityFields(kind as SavedEntityKind, entityId, workspaceId, ownerUserId),
    readSavedEntityName(kind, entityId, workspaceId, ownerUserId),
  ])
  return { entityName, fields }
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
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null,
  store?: EntityListReadStore
): Promise<EntityListEntry[]> {
  const members =
    store === undefined
      ? ownerUserId === undefined
        ? await readEntityListMembersFromDb(entityKind, workspaceId)
        : await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId)
      : await readEntityListMembersFromDb(entityKind, workspaceId, ownerUserId, store)
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
  kind: GenericSavedEntityDocumentKind,
  workspaceId: string,
  store?: EntityListReadStore
): Promise<string> {
  return hashServerToolReviewBase({
    kind,
    workspaceId,
    entities: await buildSavedEntityListInfo(kind, workspaceId, undefined, store),
  })
}

export async function executeCreateEntityDocumentMutation(
  kind: GenericSavedEntityDocumentKind,
  args: EntityDocumentArgs,
  context: ServerToolExecutionContext | undefined,
  create: CreateEntityFromDocument,
  createReviewBase?: EntityCreateReviewBase
) {
  if (args.entityId?.trim()) {
    throw new Error(`create_${kind} does not accept entityId`)
  }

  const scopedContext = withWorkspaceArgContext(context, args)
  const { userId, workspaceId } = await verifyWorkspaceContext(scopedContext, 'write')
  const acceptedReviewContext = context?.acceptedReviewBaseStateHash ? context : null
  const getReviewBaseHash = (store?: EntityListReadStore) =>
    createReviewBase?.(workspaceId, store) ?? hashCreateEntityReviewBase(kind, workspaceId, store)
  const createContext: EntityCreateContext = {
    ...(scopedContext ?? {}),
    userId,
    workspaceId,
    ...(acceptedReviewContext
      ? {
          beforeInsert: async (store: EntityListReadStore) => {
            assertAcceptedServerToolReviewBase(
              acceptedReviewContext,
              await getReviewBaseHash(store)
            )
          },
        }
      : {}),
  }
  const parsedFields = parseEntityMutationDocument(kind, args)
  const fields =
    kind === 'mcp_server' ? resolveMcpServerSecretPlaceholders(parsedFields) : parsedFields
  const name = normalizeSavedEntityIdentity(kind, args.name ?? '')

  if (shouldStageServerToolMutationForReview(context)) {
    return {
      requiresReview: true,
      success: true,
      workspaceId,
      reviewBaseStateHash: await getReviewBaseHash(),
      ...buildDocumentEnvelope(kind, undefined, name, fields),
      preview: {
        documentDiff: {
          before: '',
          after: serializeEntityDocument(kind, fields),
        },
      },
    }
  }

  const created = await create(name, fields, createContext)
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, created.entityId, created.entityName, created.fields),
  }
}

export async function executeUpdateEntityDocumentMutation(
  kind: GenericSavedEntityDocumentKind,
  toolName: string,
  args: EntityDocumentArgs,
  context: ServerToolExecutionContext | undefined
) {
  const fields = parseEntityMutationDocument(kind, args)
  const entityId = requireEntityId(args, toolName)
  const { userId, workspaceId } = await verifySavedEntityContext(context, kind, entityId, 'write')
  const requiresReview = shouldStageServerToolMutationForReview(context)

  if (requiresReview) {
    const current = await readSavedEntityDocument(kind, entityId, workspaceId)
    return {
      requiresReview: true,
      success: true,
      reviewBaseStateHash: hashServerToolReviewBase(current.fields),
      ...buildDocumentEnvelope(kind, entityId, current.entityName, fields),
      preview: {
        documentDiff: buildReviewDocumentDiff(kind, current.fields, fields),
      },
    }
  }

  const entityName = await readSavedEntityName(kind, entityId, workspaceId)

  const persistedFields = await applySavedEntityState(
    kind,
    entityId,
    workspaceId,
    userId,
    fields,
    context?.acceptedReviewBaseStateHash
      ? { expectedReviewBaseStateHash: context.acceptedReviewBaseStateHash }
      : undefined
  )
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, entityId, entityName, persistedFields),
  }
}

export async function executeRenameEntityMutation(
  kind: ReviewEntityKind,
  toolName: string,
  args: RenameEntityArgs,
  context: ServerToolExecutionContext | undefined
) {
  const entityId = requireEntityId(args, toolName)
  const identityField = kind === 'custom_tool' ? 'title' : 'name'
  const name = normalizeSavedEntityIdentity(kind, args.name)
  const { workspaceId, ownerUserId } = await verifySavedEntityContext(
    context,
    kind,
    entityId,
    'write'
  )
  const currentName = await readSavedEntityName(kind, entityId, workspaceId, ownerUserId)
  const reviewBase = { [identityField]: currentName }
  const result = {
    success: true,
    workspaceId,
    ...(ownerUserId ? { ownerUserId } : {}),
    entityKind: kind,
    entityId,
    entityName: name,
  }

  if (shouldStageServerToolMutationForReview(context)) {
    return {
      ...result,
      requiresReview: true,
      reviewBaseStateHash: hashServerToolReviewBase(reviewBase),
      preview: {
        documentDiff: {
          before: JSON.stringify(reviewBase, null, 2),
          after: JSON.stringify({ [identityField]: name }, null, 2),
        },
      },
    }
  }

  if (context?.acceptedReviewBaseStateHash) {
    assertAcceptedServerToolReviewBase(context, hashServerToolReviewBase(reviewBase))
  }

  try {
    const persisted = await renameSavedEntityIdentity({
      entityKind: kind,
      entityId,
      workspaceId,
      ownerUserId,
      name,
      expectedCurrentName: context?.acceptedReviewBaseStateHash ? currentName : undefined,
    })
    return { ...result, updatedAt: persisted.updatedAt.toISOString() }
  } catch (error) {
    if (error instanceof SavedEntityIdentityError && error.code === 'stale_server_tool_review') {
      throw new StructuredServerToolError({
        status: 409,
        body: {
          code: error.code,
          error: error.message,
          hint: 'Ask Copilot to read the current target and prepare the rename again.',
          retryable: true,
        },
      })
    }
    throw error
  }
}

export type EntityServerTool<TArgs = EntityDocumentArgs> = BaseServerTool<TArgs, any>
