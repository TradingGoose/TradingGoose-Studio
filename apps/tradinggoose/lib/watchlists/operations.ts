import { db } from '@tradinggoose/db'
import { watchlistTable } from '@tradinggoose/db/schema'
import { and, eq, isNull } from 'drizzle-orm'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import {
  fetchRootWatchlistRow,
  listRootWatchlistRowsInTx,
  loadWatchlistDocumentFields,
  mapWatchlistDocumentFieldsInTx,
  materializeWatchlistDocumentInTx,
} from '@/lib/watchlists/document'
import type { WatchlistDocumentFields, WatchlistRecord } from '@/lib/watchlists/types'
import {
  normalizeWatchlistDocumentFields,
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'
import type { EntityListBeforeInsert } from '@/lib/yjs/server/entity-loaders'
import {
  refreshEntityListSession,
  withYjsSessionDeletionLease,
} from '@/lib/yjs/server/snapshot-bridge'

type WatchlistScope = {
  workspaceId: string
}

export { materializeWatchlistDocumentInTx }

export class WatchlistOperationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WatchlistOperationError'
    this.status = status
  }
}

function mapDocumentError(error: unknown): never {
  if (error instanceof WatchlistDocumentError) {
    throw new WatchlistOperationError(error.message, error.status)
  }
  throw error
}

function isDuplicateWatchlistNameViolation(error: unknown): boolean {
  const seen = new Set<object>()
  let current = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    const record = current as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    if (
      record.code === '23505' &&
      record.constraint_name === 'watchlist_table_workspace_user_name_unique'
    ) {
      return true
    }
    current = record.cause
  }
  return false
}

const rootWatchlistWhere = (workspaceId: string, watchlistId: string) =>
  and(
    eq(watchlistTable.id, watchlistId),
    eq(watchlistTable.workspaceId, workspaceId),
    isNull(watchlistTable.userId),
    isNull(watchlistTable.parentId)
  )

function buildWatchlistRecordFromDocument(
  metadata: {
    id: string
    workspaceId: string
    createdAt: Date | string
    updatedAt: Date | string
  },
  fields: WatchlistDocumentFields
): WatchlistRecord {
  const toIso = (value: Date | string) => (value instanceof Date ? value.toISOString() : value)
  return {
    id: metadata.id,
    workspaceId: metadata.workspaceId,
    name: fields.name,
    settings: fields.settings,
    items: fields.items,
    createdAt: toIso(metadata.createdAt),
    updatedAt: toIso(metadata.updatedAt),
  }
}

export async function loadWatchlistDocument(
  workspaceId: string,
  watchlistId: string
): Promise<WatchlistDocumentFields> {
  try {
    return await loadWatchlistDocumentFields(workspaceId, watchlistId)
  } catch (error) {
    mapDocumentError(error)
  }
}

export async function createWatchlist(
  scope: WatchlistScope,
  input: { name: string }
): Promise<WatchlistRecord> {
  const name = input.name.trim()
  if (!name) {
    throw new WatchlistOperationError('Watchlist name is required', 400)
  }

  const created = await createWatchlistFromDocument(scope, {
    name,
    settings: DEFAULT_WATCHLIST_SETTINGS,
    items: [],
  })
  return getWatchlist(scope, created.id)
}

export async function createWatchlistFromDocument(
  scope: WatchlistScope,
  rawFields: Record<string, unknown>,
  options?: { beforeInsert?: EntityListBeforeInsert }
): Promise<{ id: string; fields: WatchlistDocumentFields }> {
  const fields = normalizeWatchlistDocumentFields(rawFields)

  try {
    const created = await db.transaction(async (tx) => {
      await options?.beforeInsert?.(tx)
      const roots = await listRootWatchlistRowsInTx(tx, scope.workspaceId)
      const sortOrder = roots.reduce((max, root) => Math.max(max, root.sortOrder), -1) + 1
      const [createdRoot] = await tx
        .insert(watchlistTable)
        .values({
          id: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          userId: null,
          parentId: null,
          name: fields.name,
          sortOrder,
          settings: fields.settings,
        })
        .returning({ id: watchlistTable.id })

      if (!createdRoot) {
        throw new WatchlistDocumentError('Failed to create watchlist', 500)
      }

      return {
        id: createdRoot.id,
        fields: {
          name: fields.name,
          ...(await materializeWatchlistDocumentInTx(tx, scope.workspaceId, createdRoot.id, {
            settings: fields.settings,
            items: fields.items,
          })),
        },
      }
    })

    await refreshEntityListSession('watchlist', scope.workspaceId)
    return created
  } catch (error) {
    if (isDuplicateWatchlistNameViolation(error)) {
      throw new WatchlistOperationError(
        `A watchlist with the name "${fields.name}" already exists`,
        409
      )
    }
    mapDocumentError(error)
  }
}

export async function getWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  try {
    return await db.transaction(async (tx) => {
      const root = await fetchRootWatchlistRow(tx, scope.workspaceId, watchlistId)
      const fields = await mapWatchlistDocumentFieldsInTx(tx, root)
      return buildWatchlistRecordFromDocument(root, fields)
    })
  } catch (error) {
    mapDocumentError(error)
  }
}

export async function deleteWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<boolean> {
  try {
    const [existing] = await db
      .select({ id: watchlistTable.id })
      .from(watchlistTable)
      .where(rootWatchlistWhere(scope.workspaceId, watchlistId))
      .limit(1)
    if (!existing) return false

    const deleted = await withYjsSessionDeletionLease([watchlistId], () =>
      db.transaction(async (tx) => {
        const [root] = await tx
          .select({ id: watchlistTable.id })
          .from(watchlistTable)
          .where(rootWatchlistWhere(scope.workspaceId, watchlistId))
          .limit(1)
        if (!root) return false

        await tx.delete(watchlistTable).where(rootWatchlistWhere(scope.workspaceId, watchlistId))
        return true
      })
    )

    if (deleted) {
      await refreshEntityListSession('watchlist', scope.workspaceId)
    }
    return deleted
  } catch (error) {
    mapDocumentError(error)
  }
}
