import { db } from '@tradinggoose/db'
import { watchlistTable } from '@tradinggoose/db/schema'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import {
  fetchRootWatchlistRow,
  listRootWatchlistRowsInTx,
  materializeWatchlistDocumentInTx,
  type WatchlistRootRow,
} from '@/lib/watchlists/document'
import type { WatchlistDocumentFields, WatchlistRecord } from '@/lib/watchlists/types'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentFields,
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'
import { readSavedEntityFieldsForExecution } from '@/lib/yjs/server/bootstrap-review-target'
import { type EntityListBeforeInsert, lockSavedEntityList } from '@/lib/yjs/server/entity-loaders'
import { refreshEntityListSession } from '@/lib/yjs/server/snapshot-bridge'

type WatchlistScope = {
  workspaceId: string
}

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

async function readWatchlistRecordForExecution(
  root: WatchlistRootRow,
  isDeployed: boolean
): Promise<WatchlistRecord> {
  const { id, workspaceId } = root
  const fields = await readSavedEntityFieldsForExecution('watchlist', id, workspaceId, isDeployed)
  return {
    id,
    workspaceId,
    ...normalizePersistedWatchlistDocumentFields({ ...fields, name: root.name }),
    createdAt: root.createdAt.toISOString(),
    updatedAt: root.updatedAt.toISOString(),
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
      await lockSavedEntityList(tx, 'watchlist', scope.workspaceId)
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
  watchlistId: string,
  isDeployedContext = true
): Promise<WatchlistRecord> {
  try {
    const root = await fetchRootWatchlistRow(db, scope.workspaceId, watchlistId)
    return await readWatchlistRecordForExecution(root, isDeployedContext)
  } catch (error) {
    mapDocumentError(error)
  }
}

export async function listWatchlists(
  scope: WatchlistScope,
  isDeployedContext = true
): Promise<WatchlistRecord[]> {
  try {
    const roots = await listRootWatchlistRowsInTx(db, scope.workspaceId)
    return await Promise.all(
      roots.map((root) => readWatchlistRecordForExecution(root, isDeployedContext))
    )
  } catch (error) {
    mapDocumentError(error)
  }
}
