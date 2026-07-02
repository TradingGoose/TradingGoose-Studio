import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
  workflow,
} from '@tradinggoose/db/schema'
import { and, eq, isNull, type SQL } from 'drizzle-orm'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import {
  type SavedEntityKind,
  type SavedEntityRow,
  savedEntityRowToFields,
} from '@/lib/yjs/entity-state'

const ENTITY_TABLES = {
  skill: { table: skill, name: skill.name },
  custom_tool: { table: customTools, name: customTools.title },
  indicator: { table: pineIndicators, name: pineIndicators.name },
  knowledge_base: { table: knowledgeBase, name: knowledgeBase.name, softDelete: true },
  mcp_server: { table: mcpServers, name: mcpServers.name, softDelete: true },
} as const

function entityConfig(entityKind: SavedEntityKind) {
  return ENTITY_TABLES[entityKind] as any
}

function entityCondition(entityKind: SavedEntityKind, clauses: SQL[]): SQL | undefined {
  const { table, softDelete } = entityConfig(entityKind)
  const conditions = softDelete ? [...clauses, isNull(table.deletedAt)] : clauses
  return conditions.length === 1 ? conditions[0] : and(...conditions)
}

class SavedEntityLoadError extends Error {
  status = 404

  constructor(message: string) {
    super(message)
    this.name = 'SavedEntityLoadError'
  }
}

export async function resolveEntityWorkspaceId(
  entityKind: SavedEntityKind,
  entityId: string
): Promise<string | null> {
  const { table } = entityConfig(entityKind)
  const [row] = await db
    .select({ workspaceId: table.workspaceId })
    .from(table)
    .where(entityCondition(entityKind, [eq(table.id, entityId)]))
    .limit(1)
  return row?.workspaceId ?? null
}

export async function readEntityListMembersFromDb(
  entityKind: ReviewEntityKind,
  workspaceId: string
): Promise<
  Array<{
    id: string
    name: string
    description?: string
    enabled?: boolean
    folderId?: string | null
    color?: string
    createdAt?: string
    updatedAt?: string
    connectionStatus?: string
  }>
> {
  if (entityKind === 'workflow') {
    const rows = await db
      .select({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        folderId: workflow.folderId,
        color: workflow.color,
        createdAt: workflow.createdAt,
      })
      .from(workflow)
      .where(eq(workflow.workspaceId, workspaceId))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      folderId: row.folderId,
      color: row.color,
      createdAt: row.createdAt?.toISOString(),
    }))
  }

  if (entityKind === 'mcp_server') {
    const rows = await db
      .select({
        id: mcpServers.id,
        name: mcpServers.name,
        enabled: mcpServers.enabled,
        updatedAt: mcpServers.updatedAt,
        connectionStatus: mcpServers.connectionStatus,
      })
      .from(mcpServers)
      .where(entityCondition(entityKind, [eq(mcpServers.workspaceId, workspaceId)]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? '',
      enabled: row.enabled !== false,
      updatedAt: row.updatedAt?.toISOString(),
      connectionStatus: row.connectionStatus ?? 'disconnected',
    }))
  }

  if (entityKind === 'skill') {
    const rows = await db
      .select({ id: skill.id, name: skill.name, description: skill.description })
      .from(skill)
      .where(entityCondition(entityKind, [eq(skill.workspaceId, workspaceId)]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? '',
      description: row.description ?? undefined,
    }))
  }

  if (entityKind === 'custom_tool') {
    const rows = await db
      .select({ id: customTools.id, name: customTools.title, schema: customTools.schema })
      .from(customTools)
      .where(entityCondition(entityKind, [eq(customTools.workspaceId, workspaceId)]))

    return rows.map((row) => {
      const schema = row.schema as { function?: { description?: unknown } } | null
      return {
        id: row.id,
        name: row.name ?? '',
        description:
          typeof schema?.function?.description === 'string'
            ? schema.function.description
            : undefined,
      }
    })
  }

  if (entityKind === 'indicator') {
    const rows = await db
      .select({ id: pineIndicators.id, name: pineIndicators.name, color: pineIndicators.color })
      .from(pineIndicators)
      .where(entityCondition(entityKind, [eq(pineIndicators.workspaceId, workspaceId)]))

    return rows.map((row) => ({
      id: row.id,
      name: row.name ?? '',
      ...(typeof row.color === 'string' && row.color.trim() ? { color: row.color } : {}),
    }))
  }

  const { table, name } = entityConfig(entityKind)
  const rows: Array<{ id: string; name: string | null }> = await db
    .select({ id: table.id, name })
    .from(table)
    .where(entityCondition(entityKind, [eq(table.workspaceId, workspaceId)]))

  return rows.map((row) => ({ id: row.id, name: row.name ?? '' }))
}

export async function readSavedEntityFieldsFromDb(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  const { table } = entityConfig(entityKind)
  const [row] = await db
    .select()
    .from(table)
    .where(
      entityCondition(entityKind, [eq(table.id, entityId), eq(table.workspaceId, workspaceId)])
    )
    .limit(1)

  if (!row) {
    throw new SavedEntityLoadError(`Saved ${entityKind} ${entityId} was not found`)
  }

  return savedEntityRowToFields(entityKind, row as SavedEntityRow)
}
