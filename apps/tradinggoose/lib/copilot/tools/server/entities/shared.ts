import {
  type EntityDocumentKind,
  getEntityDocumentFormat,
  getEntityDocumentName,
  parseEntityDocument,
  serializeEntityDocument,
  serializeEntityDocumentForReview,
} from '@/lib/copilot/entity-documents'
import { verifyReviewTargetAccess } from '@/lib/copilot/review-sessions/permissions'
import type {
  BaseServerTool,
  ServerToolExecutionContext,
} from '@/lib/copilot/tools/server/base-tool'
import {
  shouldStageServerToolMutationForReview,
  withWorkspaceArgContext,
} from '@/lib/copilot/tools/server/base-tool'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import type { SavedEntityKind } from '@/lib/yjs/entity-state'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { readBootstrappedSavedEntityFields } from '@/lib/yjs/server/bootstrap-review-target'

export type SavedEntityDocumentKind = EntityDocumentKind
export type EntityDocumentArgs = {
  entityId?: string
  runtimeId?: string
  workspaceId?: string
  entityDocument?: string
  documentFormat?: string
}

export type EntityListEntry = {
  entityId: string
  entityName?: string
  workspaceId?: string
  entityDescription?: string
  entityTitle?: string
  entityFunctionName?: string
  entityTransport?: string
  entityUrl?: string
  entityEnabled?: boolean
  entityConnectionStatus?: string
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
    {
      workspaceId: null,
      entityKind,
      entityId,
      draftSessionId: null,
      reviewSessionId: null,
      yjsSessionId: entityId,
    },
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

export function buildReviewDocumentEnvelope(
  kind: SavedEntityDocumentKind,
  entityId: string | undefined,
  fields: Record<string, unknown>
) {
  return {
    entityKind: kind,
    ...(entityId ? { entityId } : {}),
    entityName: getEntityDocumentName(kind, fields),
    documentFormat: getEntityDocumentFormat(kind),
    entityDocument: serializeEntityDocumentForReview(kind, fields),
  }
}

export function buildReviewDocumentDiff(
  kind: SavedEntityDocumentKind,
  before: Record<string, unknown>,
  after: Record<string, unknown>
) {
  return {
    before: serializeEntityDocumentForReview(kind, before),
    after: serializeEntityDocumentForReview(kind, after),
  }
}

export async function readSavedEntityDocumentFields(
  kind: SavedEntityDocumentKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  return readBootstrappedSavedEntityFields(kind as SavedEntityKind, entityId, workspaceId)
}

export async function applySavedEntityDocument(
  kind: SavedEntityDocumentKind,
  entityId: string,
  fields: Record<string, unknown>
): Promise<void> {
  await applySavedEntityState(kind as SavedEntityKind, entityId, fields)
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
      ...buildReviewDocumentEnvelope(kind, undefined, fields),
      preview: {
        documentDiff: {
          before: '',
          after: serializeEntityDocumentForReview(kind, fields),
        },
      },
    }
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
      ...buildReviewDocumentEnvelope(kind, entityId, fields),
      preview: {
        documentDiff: buildReviewDocumentDiff(kind, currentFields, fields),
      },
    }
  }

  if (apply) {
    await apply({ entityId, fields, workspaceId })
  } else {
    await applySavedEntityDocument(kind, entityId, fields)
  }
  return {
    success: true,
    workspaceId,
    ...buildDocumentEnvelope(kind, entityId, fields),
  }
}

export type EntityServerTool<TArgs = EntityDocumentArgs> = BaseServerTool<TArgs, any>
