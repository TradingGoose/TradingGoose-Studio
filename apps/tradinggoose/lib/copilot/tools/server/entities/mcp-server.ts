import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { ENTITY_KIND_MCP_SERVER } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { mcpService } from '@/lib/mcp/service'
import type { McpTransport } from '@/lib/mcp/types'
import { validateMcpServerUrl } from '@/lib/mcp/url-validator'
import { applySavedEntityCurrentFieldsToRows, savedEntityRowToFields } from '@/lib/yjs/entity-state'
import {
  acceptEntityDocumentReview,
  applySavedEntityDocument,
  buildDocumentEnvelope,
  type EntityCreateResult,
  type EntityListEntry,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

function isMcpTransport(value: unknown): value is McpTransport {
  return value === 'http' || value === 'sse' || value === 'streamable-http'
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      typeof item === 'string' ? item : String(item ?? ''),
    ])
  )
}

function normalizeMcpServerFields(fields: Record<string, unknown>): Record<string, unknown> {
  const transport = isMcpTransport(fields.transport) ? fields.transport : 'http'
  const rawUrl = typeof fields.url === 'string' ? fields.url.trim() : ''
  let normalizedUrl = rawUrl

  if (rawUrl) {
    const validation = validateMcpServerUrl(rawUrl)
    if (!validation.isValid) {
      throw new Error(`Invalid MCP server URL: ${validation.error}`)
    }
    normalizedUrl = validation.normalizedUrl ?? rawUrl
  }

  return {
    name: typeof fields.name === 'string' ? fields.name : '',
    description: typeof fields.description === 'string' ? fields.description : '',
    transport,
    url: normalizedUrl,
    headers: normalizeStringRecord(fields.headers),
    command: typeof fields.command === 'string' ? fields.command : '',
    args: Array.isArray(fields.args) ? fields.args.map(String) : [],
    env: normalizeStringRecord(fields.env),
    timeout: typeof fields.timeout === 'number' ? fields.timeout : 30000,
    retries: typeof fields.retries === 'number' ? fields.retries : 3,
    enabled: typeof fields.enabled === 'boolean' ? fields.enabled : true,
  }
}

function toMcpServerListEntry(row: typeof mcpServers.$inferSelect): EntityListEntry {
  return {
    entityId: row.id,
    entityName: row.name,
    workspaceId: row.workspaceId,
    entityTransport: typeof row.transport === 'string' ? row.transport : undefined,
    entityUrl: typeof row.url === 'string' ? row.url : undefined,
    entityEnabled: typeof row.enabled === 'boolean' ? row.enabled : undefined,
  }
}

async function createMcpServerEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const entityId = crypto.randomUUID()
  const normalized = normalizeMcpServerFields(fields)

  const [row] = await db
    .insert(mcpServers)
    .values({
      id: entityId,
      workspaceId,
      createdBy: userId,
      name: String(normalized.name ?? ''),
      description: String(normalized.description ?? '') || null,
      transport: normalized.transport as McpTransport,
      url: String(normalized.url ?? '') || null,
      headers: normalizeStringRecord(normalized.headers),
      command: String(normalized.command ?? '') || null,
      args: Array.isArray(normalized.args) ? normalized.args.map(String) : [],
      env: normalizeStringRecord(normalized.env),
      timeout: Number(normalized.timeout ?? 30000),
      retries: Number(normalized.retries ?? 3),
      enabled: normalized.enabled !== false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  if (!row) {
    throw new Error('Created MCP server was not returned from canonical insert')
  }

  const savedFields = savedEntityRowToFields(ENTITY_KIND_MCP_SERVER, row)
  try {
    await applySavedEntityDocument(ENTITY_KIND_MCP_SERVER, row.id, savedFields)
  } catch (error) {
    await db.delete(mcpServers).where(eq(mcpServers.id, row.id))
    throw error
  }
  mcpService.clearCache(workspaceId)

  return {
    entityId,
    fields: savedFields,
  }
}

async function applyMcpServerDocument(input: {
  entityId: string
  fields: Record<string, unknown>
  workspaceId: string
}) {
  await applySavedEntityDocument(
    ENTITY_KIND_MCP_SERVER,
    input.entityId,
    normalizeMcpServerFields(input.fields)
  )
  mcpService.clearCache(input.workspaceId)
}

export const listMcpServersServerTool: EntityServerTool<Record<string, never>> = {
  name: 'list_mcp_servers',
  async execute(args, context) {
    const { workspaceId } = await verifyWorkspaceContext(
      withWorkspaceArgContext(context, args),
      'read'
    )
    const rows = await db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.workspaceId, workspaceId), isNull(mcpServers.deletedAt)))
      .then((serverRows) => applySavedEntityCurrentFieldsToRows(ENTITY_KIND_MCP_SERVER, serverRows))
    const entities = rows.map(toMcpServerListEntry)

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
    const fields = await readSavedEntityDocumentFields(
      ENTITY_KIND_MCP_SERVER,
      entityId,
      workspaceId
    )
    return buildDocumentEnvelope(ENTITY_KIND_MCP_SERVER, entityId, fields)
  },
}

export const createMcpServerServerTool: EntityServerTool = {
  name: 'create_mcp_server',
  execute(args, context) {
    return executeCreateEntityDocumentMutation(
      ENTITY_KIND_MCP_SERVER,
      args,
      context,
      createMcpServerEntity,
      normalizeMcpServerFields
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
      context,
      applyMcpServerDocument,
      normalizeMcpServerFields
    )
  },
}

export const renameMcpServerServerTool: EntityServerTool = {
  name: 'rename_mcp_server',
  execute(args, context) {
    return executeUpdateEntityDocumentMutation(
      ENTITY_KIND_MCP_SERVER,
      'rename_mcp_server',
      args,
      context,
      applyMcpServerDocument,
      normalizeMcpServerFields
    )
  },
}

export function acceptMcpServerDocumentReview(
  toolName: string,
  result: unknown,
  context: Parameters<typeof acceptEntityDocumentReview>[0]['context']
) {
  return acceptEntityDocumentReview({
    kind: ENTITY_KIND_MCP_SERVER,
    toolName,
    result,
    context,
    create: createMcpServerEntity,
    apply: applyMcpServerDocument,
  })
}
