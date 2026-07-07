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
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import type { WatchlistDocumentFields, WatchlistRecord } from '@/lib/watchlists/types'
import { assertCanDeleteWorkspaceEntityDocument } from '@/lib/workspaces/entity-documents'
import {
  deleteYjsSessionInSocketServer,
  refreshEntityListSession,
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
  if (error instanceof Error && error.name === 'WorkspaceEntityDocumentDeletionError') {
    throw new WatchlistOperationError(error.message, 400)
  }
  throw error
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

export async function listWatchlists(scope: WatchlistScope): Promise<WatchlistRecord[]> {
  try {
    return await db.transaction(async (tx) => {
      const roots = await listRootWatchlistRowsInTx(tx, scope.workspaceId)
      const records: WatchlistRecord[] = []
      for (const root of roots) {
        const fields = await mapWatchlistDocumentFieldsInTx(tx, root)
        records.push(buildWatchlistRecordFromDocument(root, fields))
      }
      return records
    })
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

  try {
    const watchlistId = await db.transaction(async (tx) => {
      const roots = await listRootWatchlistRowsInTx(tx, scope.workspaceId)
      if (roots.some((root) => root.name === name)) {
        throw new WatchlistDocumentError(`A watchlist with the name "${name}" already exists`, 409)
      }

      const sortOrder =
        roots.reduce((max, root) => Math.max(max, root.sortOrder), -1) + 1
      const [created] = await tx
        .insert(watchlistTable)
        .values({
          id: crypto.randomUUID(),
          workspaceId: scope.workspaceId,
          userId: null,
          parentId: null,
          name,
          sortOrder,
          settings: DEFAULT_WATCHLIST_SETTINGS,
        })
        .returning({ id: watchlistTable.id })

      if (!created) {
        throw new WatchlistDocumentError('Failed to create watchlist', 500)
      }
      return created.id
    })

    await refreshEntityListSession('watchlist', scope.workspaceId)
    return getWatchlist(scope, watchlistId)
  } catch (error) {
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

export async function deleteWatchlist(scope: WatchlistScope, watchlistId: string): Promise<boolean> {
  try {
    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: watchlistTable.id })
        .from(watchlistTable)
        .where(rootWatchlistWhere(scope.workspaceId, watchlistId))
        .limit(1)

      if (!existing) {
        return false
      }

      await assertCanDeleteWorkspaceEntityDocument({
        entityKind: 'watchlist',
        workspaceId: scope.workspaceId,
      })

      await tx.delete(watchlistTable).where(rootWatchlistWhere(scope.workspaceId, watchlistId))
      return true
    })

    if (deleted) {
      await refreshEntityListSession('watchlist', scope.workspaceId)
      await Promise.allSettled([deleteYjsSessionInSocketServer(watchlistId)])
    }
    return deleted
  } catch (error) {
    mapDocumentError(error)
  }
}
