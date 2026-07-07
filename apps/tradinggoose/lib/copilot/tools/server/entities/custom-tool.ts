import { ENTITY_KIND_CUSTOM_TOOL } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { createCustomTools } from '@/lib/custom-tools/operations'
import { parseCustomToolSchemaText } from '@/lib/custom-tools/schema'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateContext,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

async function createCustomToolEntity(
  fields: Record<string, unknown>,
  { userId, workspaceId }: EntityCreateContext
): Promise<EntityCreateResult> {
  const rows = await createCustomTools({
    userId,
    workspaceId,
    tools: [
      {
        title: String(fields.title ?? ''),
        schema: parseCustomToolSchemaText(fields.schemaText),
        code: String(fields.codeText ?? ''),
      },
    ],
  })
  const row = rows[0]
  if (!row) {
    throw new Error('Created custom tool was not returned')
  }

  return {
    entityId: row.id,
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
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_CUSTOM_TOOL, workspaceId)

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
    const fields = await readSavedEntityDocumentFields(
      ENTITY_KIND_CUSTOM_TOOL,
      entityId,
      workspaceId
    )
    return buildDocumentEnvelope(ENTITY_KIND_CUSTOM_TOOL, entityId, fields)
  },
}

export const createCustomToolServerTool: EntityServerTool = {
  name: 'create_custom_tool',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_CUSTOM_TOOL,
      args,
      context,
      createCustomToolEntity
    )
  },
}

export const editCustomToolServerTool: EntityServerTool = {
  name: 'edit_custom_tool',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_CUSTOM_TOOL,
      'edit_custom_tool',
      args,
      context
    )
  },
}

export const renameCustomToolServerTool: EntityServerTool = {
  name: 'rename_custom_tool',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_CUSTOM_TOOL,
      'rename_custom_tool',
      args,
      context
    )
  },
}
