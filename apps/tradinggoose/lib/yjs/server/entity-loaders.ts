import { db } from '@tradinggoose/db'
import {
  customTools,
  knowledgeBase,
  layoutMaps,
  mcpServers,
  pineIndicators,
  skill,
  watchlistTable,
  workflow,
} from '@tradinggoose/db/schema'
import { and, asc, eq, isNull, type SQL, sql } from 'drizzle-orm'
import type { ReviewEntityKind } from '@/lib/copilot/review-sessions/types'
import {
  listDashboardLayouts,
  readPersistedDashboardLayoutDocument,
} from '@/lib/dashboard-layouts/operations'
import {
  listRootWatchlistRowsInTx,
  loadWatchlistDocumentFields,
  rootWatchlistCondition,
} from '@/lib/watchlists/document'
import {
  type SavedEntityKind,
  type SavedEntityRow,
  savedEntityRowToContent,
} from '@/lib/yjs/entity-state'
import {
  refreshEntityListSession,
  runYjsDrainFencedTransaction,
} from '@/lib/yjs/server/snapshot-bridge'

const ENTITY_TABLES = {
  skill: { table: skill, name: skill.name, softDelete: false },
  custom_tool: { table: customTools, name: customTools.title, softDelete: false },
  indicator: { table: pineIndicators, name: pineIndicators.name, softDelete: false },
  knowledge_base: { table: knowledgeBase, name: knowledgeBase.name, softDelete: true },
  mcp_server: { table: mcpServers, name: mcpServers.name, softDelete: true },
} as const

const SAVED_ENTITY_LIST_LOCK_NAMESPACE = 1_904_202_618

export type RowBackedSavedEntityKind = Exclude<SavedEntityKind, 'watchlist' | 'dashboard_layout'>
export type SavedEntityListLockKind = RowBackedSavedEntityKind | 'workflow' | 'watchlist'
export const SAVED_ENTITY_LIST_LOCK_KINDS: SavedEntityListLockKind[] = [
  ...(Object.keys(ENTITY_TABLES) as RowBackedSavedEntityKind[]),
  'workflow',
  'watchlist',
]
export type EntityListReadStore = Pick<typeof db, 'select'>
export type EntityListBeforeInsert = (store: EntityListReadStore) => Promise<void> | void
type EntityListLockWriter = Pick<typeof db, 'execute'>

export async function lockSavedEntityList(
  tx: EntityListLockWriter,
  entityKind: SavedEntityListLockKind,
  workspaceId: string
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${SAVED_ENTITY_LIST_LOCK_NAMESPACE}, hashtext(${`${entityKind}:${workspaceId}`}))`
  )
}

function entityCondition(entityKind: RowBackedSavedEntityKind, clauses: SQL[]): SQL | undefined {
  const config = ENTITY_TABLES[entityKind]
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
  entityId: string,
  ownerUserId?: string | null
): Promise<string | null> {
  if (entityKind === 'watchlist') {
    const [row] = await db
      .select({ workspaceId: watchlistTable.workspaceId })
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.id, entityId),
          isNull(watchlistTable.userId),
          isNull(watchlistTable.parentId)
        )
      )
      .limit(1)
    return row?.workspaceId ?? null
  }

  if (entityKind === 'dashboard_layout') {
    if (!ownerUserId) {
      throw new SavedEntityLoadError('Dashboard layout ownerUserId is required')
    }
    const [row] = await db
      .select({ workspaceId: layoutMaps.workspaceId })
      .from(layoutMaps)
      .where(and(eq(layoutMaps.id, entityId), eq(layoutMaps.userId, ownerUserId)))
      .limit(1)
    return row?.workspaceId ?? null
  }

  const { table } = ENTITY_TABLES[entityKind]
  const [row] = await db
    .select({ workspaceId: table.workspaceId })
    .from(table)
    .where(entityCondition(entityKind, [eq(table.id, entityId)]))
    .limit(1)
  return row?.workspaceId ?? null
}

export async function deleteSavedEntity(
  entityKind: Exclude<SavedEntityKind, 'dashboard_layout'>,
  entityId: string,
  workspaceId: string
): Promise<boolean> {
  if ((await resolveEntityWorkspaceId(entityKind, entityId)) !== workspaceId) return false

  const deleted = await runYjsDrainFencedTransaction({ sessionIds: [entityId] }, async (tx) => {
    await lockSavedEntityList(tx, entityKind, workspaceId)
    let deleted: boolean
    if (entityKind === 'watchlist') {
      const [row] = await tx
        .delete(watchlistTable)
        .where(rootWatchlistCondition(workspaceId, entityId))
        .returning({ id: watchlistTable.id })
      deleted = Boolean(row)
    } else if (entityKind === 'knowledge_base') {
      const now = new Date()
      const [row] = await tx
        .update(knowledgeBase)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          entityCondition(entityKind, [
            eq(knowledgeBase.id, entityId),
            eq(knowledgeBase.workspaceId, workspaceId),
          ])
        )
        .returning({ id: knowledgeBase.id })
      deleted = Boolean(row)
    } else {
      const { table } = ENTITY_TABLES[entityKind]
      const [row] = await tx
        .delete(table)
        .where(
          entityCondition(entityKind, [eq(table.id, entityId), eq(table.workspaceId, workspaceId)])
        )
        .returning({ id: table.id })
      deleted = Boolean(row)
    }
    return deleted
  })
  if (deleted) await refreshEntityListSession(entityKind, workspaceId)
  return deleted
}

export async function readEntityListMembersFromDb(
  entityKind: ReviewEntityKind,
  workspaceId: string,
  ownerUserId?: string | null,
  store: EntityListReadStore = db
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
    isActive?: boolean
    sortOrder?: number
  }>
> {
  if (entityKind === 'workflow') {
    const rows = await store
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
    const roots = await listRootWatchlistRowsInTx(store, workspaceId)
    return roots.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: row.createdAt?.toISOString(),
      updatedAt: row.updatedAt?.toISOString(),
    }))
  }

  if (entityKind === 'dashboard_layout') {
    if (!ownerUserId) {
      throw new SavedEntityLoadError('Dashboard layout list ownerUserId is required')
    }

    return listDashboardLayouts({ workspaceId, ownerUserId })
  }

  if (entityKind === 'mcp_server') {
    const rows = await store
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
    const rows = await store
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
    const rows = await store
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
    const rows = await store
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

  const { table, name } = ENTITY_TABLES[entityKind]
  const rows: Array<{ id: string; name: string | null }> = await store
    .select({ id: table.id, name })
    .from(table)
    .where(entityCondition(entityKind, [eq(table.workspaceId, workspaceId)]))
    .orderBy(asc(name), asc(table.id))

  return rows.map((row) => ({ id: row.id, name: row.name ?? '' }))
}

export async function readSavedEntityFieldsFromDb(
  entityKind: SavedEntityKind,
  entityId: string,
  workspaceId: string,
  ownerUserId?: string | null
): Promise<Record<string, unknown>> {
  if (entityKind === 'watchlist') {
    const watchlist = await loadWatchlistDocumentFields(workspaceId, entityId)
    return {
      settings: watchlist.settings,
      items: watchlist.items,
    }
  }

  if (entityKind === 'dashboard_layout') {
    if (!ownerUserId) {
      throw new SavedEntityLoadError('Dashboard layout ownerUserId is required')
    }
    return readPersistedDashboardLayoutDocument({ workspaceId, ownerUserId }, entityId)
  }

  const { table } = ENTITY_TABLES[entityKind]
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

  return savedEntityRowToContent(entityKind, row as SavedEntityRow)
}
