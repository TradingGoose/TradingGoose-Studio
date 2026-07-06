import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  mcpServers,
  pineIndicators,
  skill,
  workflow,
} from '@tradinggoose/db/schema'
import { and, asc, eq, isNull, type SQL } from 'drizzle-orm'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import { loadWatchlistDocument } from '@/lib/watchlists/operations'
import {
  type SavedEntityKind,
  type SavedEntityRow,
  savedEntityRowToFields,
} from '@/lib/yjs/entity-state'

const ENTITY_TABLES = {
  skill: { table: skill, name: skill.name, softDelete: false },
  custom_tool: { table: customTools, name: customTools.title, softDelete: false },
  indicator: { table: pineIndicators, name: pineIndicators.name, softDelete: false },
  knowledge_base: { table: knowledgeBase, name: knowledgeBase.name, softDelete: true },
  mcp_server: { table: mcpServers, name: mcpServers.name, softDelete: true },
} as const

type RowBackedSavedEntityKind = Exclude<SavedEntityKind, 'watchlist'>

function entityConfig(entityKind: RowBackedSavedEntityKind) {
  switch (entityKind) {
    case 'skill':
      return ENTITY_TABLES.skill
    case 'custom_tool':
      return ENTITY_TABLES.custom_tool
    case 'indicator':
      return ENTITY_TABLES.indicator
    case 'knowledge_base':
      return ENTITY_TABLES.knowledge_base
    case 'mcp_server':
      return ENTITY_TABLES.mcp_server
  }
}

function entityCondition(entityKind: RowBackedSavedEntityKind, clauses: SQL[]): SQL | undefined {
  const config = entityConfig(entityKind)
  const conditions = config.softDelete ? [...clauses, isNull(config.table.deletedAt)] : clauses
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
  if (entityKind === 'watchlist') {
    return entityId
  }

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
      .orderBy(asc(workflow.name), asc(workflow.id))

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      folderId: row.folderId,
      color: row.color,
      createdAt: row.createdAt?.toISOString(),
    }))
  }

  if (entityKind === 'watchlist') {
    const createdAt = new Date(0).toISOString()
    return [{ id: workspaceId, name: 'Watchlist', createdAt, updatedAt: createdAt }]
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
      .orderBy(asc(mcpServers.name), asc(mcpServers.id))

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
      .orderBy(asc(skill.name), asc(skill.id))

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
      .orderBy(asc(customTools.title), asc(customTools.id))

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
      .orderBy(asc(pineIndicators.name), asc(pineIndicators.id))

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
    .orderBy(asc(name), asc(table.id))

  return rows.map((row) => ({ id: row.id, name: row.name ?? '' }))
}

export async function readSavedEntityFieldsFromDb(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string
): Promise<Record<string, unknown>> {
  if (entityKind === 'watchlist') {
    const watchlist = await loadWatchlistDocument(workspaceId, entityId)
    return {
      name: watchlist.name,
      settings: watchlist.settings,
      items: watchlist.items,
    }
  }

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
