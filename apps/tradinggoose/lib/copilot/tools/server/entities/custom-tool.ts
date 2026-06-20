import { nanoid } from 'nanoid'
import { ENTITY_KIND_CUSTOM_TOOL } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { listCustomTools, upsertCustomTools } from '@/lib/custom-tools/operations'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  acceptEntityDocumentReview,
  buildCreateEntityReviewResult,
  buildDocumentEnvelope,
  buildUpdateEntityReviewResult,
  type EntityCreateResult,
  type EntityListEntry,
  type EntityServerTool,
  readSavedEntityYjsFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

function readFunctionSchemaField(row: Awaited<ReturnType<typeof listCustomTools>>[number]) {
  const functionSchema =
    row.schema && typeof row.schema === 'object' && 'function' in row.schema
      ? row.schema.function
      : null

  if (!functionSchema || typeof functionSchema !== 'object') {
    return {}
  }

  return {
    functionName:
      'name' in functionSchema && typeof functionSchema.name === 'string'
        ? functionSchema.name
        : undefined,
    functionDescription:
      'description' in functionSchema && typeof functionSchema.description === 'string'
        ? functionSchema.description
        : undefined,
  }
}

function toCustomToolListEntry(
  row: Awaited<ReturnType<typeof listCustomTools>>[number]
): EntityListEntry {
  const { functionName, functionDescription } = readFunctionSchemaField(row)

  return {
    entityId: row.id,
    entityName: row.title ?? functionName ?? '',
    workspaceId: row.workspaceId,
    entityTitle: row.title ?? '',
    entityFunctionName: functionName,
    entityDescription: functionDescription,
  }
}

async function createCustomToolEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const entityId = nanoid()
  const rows = await upsertCustomTools({
    userId,
    workspaceId,
    tools: [
      {
        id: entityId,
        title: String(fields.title ?? ''),
        schema: parseCustomToolSchemaText(fields.schemaText),
        code: String(fields.codeText ?? ''),
      },
    ],
  })
  const row = rows.find((candidate) => candidate.id === entityId)
  if (!row) {
    throw new Error('Created custom tool was not returned from canonical upsert')
  }

  return {
    entityId,
    fields: savedEntityRowToFields(ENTITY_KIND_CUSTOM_TOOL, row),
  }
}

export const listCustomToolsServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_custom_tools',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const rows = await listCustomTools({ workspaceId })
    const entities = rows.map(toCustomToolListEntry)

    return {
      entityKind: ENTITY_KIND_CUSTOM_TOOL,
      entities,
      count: entities.length,
    }
  },
}

export const readCustomToolServerTool: EntityServerTool = {
  name: 'read_custom_tool',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_custom_tool')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_CUSTOM_TOOL,
      entityId,
      'read'
    )
    const fields = await readSavedEntityYjsFields(ENTITY_KIND_CUSTOM_TOOL, entityId, workspaceId)
    return buildDocumentEnvelope(ENTITY_KIND_CUSTOM_TOOL, entityId, fields)
  },
}

export const createCustomToolServerTool: EntityServerTool = {
  name: 'create_custom_tool',
  execute(args, context) {
    return buildCreateEntityReviewResult(ENTITY_KIND_CUSTOM_TOOL, args, context)
  },
}

export const editCustomToolServerTool: EntityServerTool = {
  name: 'edit_custom_tool',
  execute(args, context) {
    return buildUpdateEntityReviewResult(ENTITY_KIND_CUSTOM_TOOL, 'edit_custom_tool', args, context)
  },
}

export const renameCustomToolServerTool: EntityServerTool = {
  name: 'rename_custom_tool',
  execute(args, context) {
    return buildUpdateEntityReviewResult(
      ENTITY_KIND_CUSTOM_TOOL,
      'rename_custom_tool',
      args,
      context
    )
  },
}

export function acceptCustomToolDocumentReview(
  toolName: string,
  result: unknown,
  context: Parameters<typeof acceptEntityDocumentReview>[0]['context']
) {
  return acceptEntityDocumentReview({
    kind: ENTITY_KIND_CUSTOM_TOOL,
    toolName,
    result,
    context,
    create: createCustomToolEntity,
  })
}
