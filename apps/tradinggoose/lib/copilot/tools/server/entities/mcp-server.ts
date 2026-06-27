import { db } from '@tradinggoose/db'
import { mcpServers } from '@tradinggoose/db/schema'
import { eq } from 'drizzle-orm'
import {
  ENTITY_SECRET_PLACEHOLDER,
  normalizeEntityFields,
  normalizeStringRecord,
} from '@/lib/copilot/entity-documents'
import { ENTITY_KIND_MCP_SERVER } from '@/lib/copilot/review-sessions/types'
import { withWorkspaceArgContext } from '@/lib/copilot/tools/server/base-tool'
import { mcpService } from '@/lib/mcp/service'
import type { McpTransport } from '@/lib/mcp/types'
import { savedEntityRowToFields } from '@/lib/yjs/entity-state'
import { applySavedEntityState } from '@/lib/yjs/server/apply-entity-state'
import { notifyEntityListMembersAdded } from '@/lib/yjs/server/snapshot-bridge'
import {
  buildDocumentEnvelope,
  buildSavedEntityListInfo,
  type EntityCreateResult,
  type EntityServerTool,
  executeCreateEntityDocumentMutation,
  executeUpdateEntityDocumentMutation,
  readSavedEntityDocumentFields,
  requireEntityId,
  verifySavedEntityContext,
  verifyWorkspaceContext,
} from './shared'

function normalizeMcpServerDocumentFields(
  fields: Record<string, unknown>
): Record<string, unknown> {
  return normalizeEntityFields(ENTITY_KIND_MCP_SERVER, fields)
}

function preserveSecretRecordPlaceholders(
  fieldName: 'headers' | 'env',
  nextValues: Record<string, string>,
  currentValues: Record<string, string>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(nextValues).map(([key, value]) => {
      if (value !== ENTITY_SECRET_PLACEHOLDER) {
        return [key, value]
      }
      const currentValue = currentValues[key]
      if (typeof currentValue !== 'string') {
        throw new Error(`Cannot preserve missing MCP server ${fieldName} value "${key}"`)
      }
      return [key, currentValue]
    })
  )
}

function assertNoSecretPlaceholders(fields: Record<string, unknown>): void {
  for (const fieldName of ['headers', 'env'] as const) {
    const values = normalizeStringRecord(fields[fieldName])
    const placeholderKey = Object.entries(values).find(
      ([, value]) => value === ENTITY_SECRET_PLACEHOLDER
    )?.[0]
    if (placeholderKey) {
      throw new Error(
        `Cannot use ${ENTITY_SECRET_PLACEHOLDER} for new MCP server ${fieldName} value "${placeholderKey}"`
      )
    }
  }
}

function preserveMcpServerSecretPlaceholders(
  nextFields: Record<string, unknown>,
  currentFields: Record<string, unknown>
): Record<string, unknown> {
  const normalizedNext = normalizeMcpServerDocumentFields(nextFields)
  const normalizedCurrent = normalizeMcpServerDocumentFields(currentFields)

  return {
    ...normalizedNext,
    headers: preserveSecretRecordPlaceholders(
      'headers',
      normalizeStringRecord(normalizedNext.headers),
      normalizeStringRecord(normalizedCurrent.headers)
    ),
    env: preserveSecretRecordPlaceholders(
      'env',
      normalizeStringRecord(normalizedNext.env),
      normalizeStringRecord(normalizedCurrent.env)
    ),
  }
}

function prepareNewMcpServerFields(fields: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeMcpServerDocumentFields(fields)
  assertNoSecretPlaceholders(normalized)
  return normalized
}

async function createMcpServerEntity(
  fields: Record<string, unknown>,
  context: Parameters<typeof verifyWorkspaceContext>[0]
): Promise<EntityCreateResult> {
  const { userId, workspaceId } = await verifyWorkspaceContext(context, 'write')
  const entityId = crypto.randomUUID()
  const normalized = normalizeMcpServerDocumentFields(fields)

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
    await notifyEntityListMembersAdded('mcp_server', workspaceId, [
      { id: entityId, name: String(normalized.name ?? ''), enabled: normalized.enabled !== false },
    ])
  } catch (error) {
    await db.delete(mcpServers).where(eq(mcpServers.id, entityId))
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
  const currentFields = await readSavedEntityDocumentFields(
    ENTITY_KIND_MCP_SERVER,
    input.entityId,
    input.workspaceId
  )
  await applySavedEntityState(
    ENTITY_KIND_MCP_SERVER,
    input.entityId,
    preserveMcpServerSecretPlaceholders(input.fields, currentFields)
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
      prepareNewMcpServerFields
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
      normalizeMcpServerDocumentFields
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
      normalizeMcpServerDocumentFields
    )
  },
}
