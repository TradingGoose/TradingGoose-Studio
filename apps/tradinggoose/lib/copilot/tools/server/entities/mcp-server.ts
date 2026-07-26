import { ENTITY_KIND_MCP_SERVER } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { mcpService } from '@/lib/mcp/service'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateContext,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeRenameEntityMutation,
  executeUpdateEntityDocumentMutation,
  type RenameEntityArgs,
  readSavedEntityDocument,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

async function createMcpServerEntity(
  name: string,
  fields: Record<string, unknown>,
  { userId, workspaceId, beforeInsert }: EntityCreateContext
): Promise<EntityCreateResult> {
  const created = await mcpService.createWorkspaceServer({
    userId,
    workspaceId,
    name,
    fields,
    beforeInsert,
  })

  return {
    entityId: created.entityId,
    entityName: created.entityName,
    fields: created.fields,
  }
}

export const listMcpServersServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_mcp_servers',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const entities = await buildSavedEntityListInfo(ENTITY_KIND_MCP_SERVER, workspaceId)

    return {
      entityKind: ENTITY_KIND_MCP_SERVER,
      entities,
      count: entities.length,
    }
  },
}

export const readMcpServerServerTool: EntityServerTool = {
  name: 'read_mcp_server',
  async execute(args, context) {
    const entityId = requireEntityId(args, 'read_mcp_server')
    const { workspaceId } = await verifySavedEntityContext(
      context,
      ENTITY_KIND_MCP_SERVER,
      entityId,
      'read'
    )
    const document = await readSavedEntityDocument(ENTITY_KIND_MCP_SERVER, entityId, workspaceId)
    return buildDocumentEnvelope(
      ENTITY_KIND_MCP_SERVER,
      entityId,
      document.entityName,
      document.fields
    )
  },
}

export const createMcpServerServerTool: EntityServerTool = {
  name: 'create_mcp_server',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_MCP_SERVER,
      args,
      context,
      createMcpServerEntity
    )
  },
}

export const editMcpServerServerTool: EntityServerTool = {
  name: 'edit_mcp_server',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_MCP_SERVER,
      'edit_mcp_server',
      args,
      context
    )
  },
}

export const renameMcpServerServerTool: EntityServerTool<RenameEntityArgs> = {
  name: 'rename_mcp_server',
  execute(args, context) {
    return executeRenameEntityMutation(ENTITY_KIND_MCP_SERVER, 'rename_mcp_server', args, context)
  },
}
