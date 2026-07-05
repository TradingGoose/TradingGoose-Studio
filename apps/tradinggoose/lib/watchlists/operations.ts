import { db } from '@tradinggoose/db'
import { watchlistTable } from '@tradinggoose/db/schema'
import { asc } from 'drizzle-orm'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import {
  createWatchlistDocumentInTx,
  fetchRootWatchlistRow,
  loadWatchlistDocumentFields,
  mapWatchlistDocumentFieldsInTx,
  materializeWatchlistDocumentInTx,
  rootWatchlistCondition,
} from '@/lib/watchlists/document'
import {
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'
import type { WatchlistDocumentFields, WatchlistRecord } from '@/lib/watchlists/types'
import {
  refreshEntityListSession,
  deleteYjsSessionInSocketServer,
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

const isUniqueViolation = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('watchlist_table_workspace_root_name_unique') ||
    error.message.includes('watchlist_item_watchlist_listing_identity_unique') ||
    error.message.toLowerCase().includes('duplicate key'))

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
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(watchlistTable)
      .where(rootWatchlistCondition(scope.workspaceId))
      .orderBy(asc(watchlistTable.name), asc(watchlistTable.createdAt))

    return Promise.all(
      rows.map(async (row) => {
        const fields = await mapWatchlistDocumentFieldsInTx(tx, row)
        return buildWatchlistRecordFromDocument(row, fields)
      })
    )
  })
}

export async function getWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  try {
    return await db.transaction(async (tx) => {
      const row = await fetchRootWatchlistRow(tx, scope.workspaceId, watchlistId)
      const fields = await mapWatchlistDocumentFieldsInTx(tx, row)
      return buildWatchlistRecordFromDocument(row, fields)
    })
  } catch (error) {
    mapDocumentError(error)
  }
}

export async function createWatchlistDocument(
  workspaceId: string,
  rawFields: Record<string, unknown>
): Promise<WatchlistRecord> {
  try {
    const created = await db.transaction((tx) =>
      createWatchlistDocumentInTx(tx, workspaceId, rawFields)
    )

    await refreshEntityListSession('watchlist', workspaceId)
    return buildWatchlistRecordFromDocument(
      {
        id: created.id,
        workspaceId,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      created.fields
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WatchlistOperationError('A watchlist with this name already exists', 409)
    }
    mapDocumentError(error)
  }
}

export async function createWatchlist(
  scope: WatchlistScope,
  rawName: string
): Promise<WatchlistRecord> {
  return createWatchlistDocument(scope.workspaceId, {
    name: rawName,
    settings: DEFAULT_WATCHLIST_SETTINGS,
    items: [],
  })
}

export async function deleteWatchlist(scope: WatchlistScope, watchlistId: string): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await fetchRootWatchlistRow(tx, scope.workspaceId, watchlistId)
      await tx.delete(watchlistTable).where(rootWatchlistCondition(scope.workspaceId, watchlistId))
    })
  } catch (error) {
    mapDocumentError(error)
  }

  await refreshEntityListSession('watchlist', scope.workspaceId)
  await Promise.allSettled([deleteYjsSessionInSocketServer(watchlistId)])
}
