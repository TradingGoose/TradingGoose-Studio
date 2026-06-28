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
import {
  readBootstrappedSavedEntityFields,
  requireSavedEntityListMembers,
} from '@/lib/yjs/server/bootstrap-review-target'

export type SavedEntityDocumentKind = EntityDocumentKind
export type EntityDocumentArgs = {
  entityId?: string
  runtimeId?: string
  workspaceId?: string
  entityDocument?: string
  documentFormat?: string
}

/**
 * Canonical list_* entry. A list is a discovery surface — "what exists" — so it
 * carries only the entity's id and canonical name, never per-entity details.
 */
export type EntityListEntry = {
  entityId: string
  entityName: string
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

export type CreateEntityFromDocument = (
  fields: Record<string, unknown>,
  context: ServerToolExecutionContext | undefined
) => Promise<EntityCreateResult>

export type ApplyEntityDocument = (input: {
  entityId: string
  fields: Record<string, unknown>
  workspaceId: string
}) => Promise<void>

export type PrepareEntityDocumentFields = (
  fields: Record<string, unknown>
) => Record<string, unknown>

export const ENTITY_KIND_LABELS: Record<SavedEntityDocumentKind, string> = {
  skill: 'skill',
  custom_tool: 'custom tool',
  indicator: 'indicator',
  knowledge_base: 'knowledge base',
  mcp_server: 'MCP server',
}

export function requireUserId(context?: ServerToolExecutionContext): string {
  const userId = context?.userId?.trim()
  if (!userId) {
    throw new Error('Authenticated user is required to execute copilot entity tools')
  }
  return userId
}

export function requireWorkspaceId(context?: ServerToolExecutionContext): string {
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
): Promise<{ userId: string; workspaceId: string }> {
  const userId = requireUserId(context)
  const access = await verifyReviewTargetAccess(
    userId,
    buildSavedEntityDescriptor(entityKind, entityId, context?.workspaceId?.trim() ?? null),
    accessMode
  )

  if (!access.hasAccess || !access.workspaceId) {
    throw new Error(
      `Access denied: You do not have permission to ${accessMode === 'write' ? 'edit' : 'read'} this ${ENTITY_KIND_LABELS[entityKind]}`
    )
  }

  return { userId, workspaceId: access.workspaceId }
}

export function requireEntityId(args: EntityDocumentArgs, toolName: string): string {
  const entityId = args.entityId?.trim()
  if (!entityId) {
    throw new Error(`entityId is required for ${toolName}`)
  }
  return entityId
}

export function parseEntityMutationDocument(
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
  workspaceId: string
): Promise<Record<string, unknown>> {
  return readBootstrappedSavedEntityFields(kind as SavedEntityKind, entityId, workspaceId)
}

/**
 * Canonical read for every saved-entity list_* tool: the workspace's membership
 * through the live Yjs list session (id + canonical name only). Reflects realtime
 * create/delete by any user — one read for all kinds, no per-tool list mapper.
 */
export function buildSavedEntityListInfo(
  entityKind: SavedEntityKind,
  workspaceId: string
): Promise<EntityListEntry[]> {
  return requireSavedEntityListMembers(entityKind, workspaceId)
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

  if (apply) {
    await apply({ entityId, fields, workspaceId })
  } else {
    await applySavedEntityState(kind, entityId, fields)
  }
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, entityId, fields),
  }
}

export type EntityServerTool<TArgs = EntityDocumentArgs> = BaseServerTool<TArgs, any>
