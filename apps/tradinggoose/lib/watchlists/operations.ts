import {
  loadWatchlistDocumentFields,
  materializeWatchlistDocumentInTx,
} from '@/lib/watchlists/document'
import { WatchlistDocumentError } from '@/lib/watchlists/validation'
import type { WatchlistDocumentFields, WatchlistRecord } from '@/lib/watchlists/types'

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

const ROOT_TIMESTAMP = new Date(0).toISOString()

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

function buildRootWatchlistMetadata(workspaceId: string) {
  return {
    id: workspaceId,
    workspaceId,
    createdAt: ROOT_TIMESTAMP,
    updatedAt: ROOT_TIMESTAMP,
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
  const fields = await loadWatchlistDocument(scope.workspaceId, scope.workspaceId)
  return [buildWatchlistRecordFromDocument(buildRootWatchlistMetadata(scope.workspaceId), fields)]
}

export async function getWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  try {
    const fields = await loadWatchlistDocument(scope.workspaceId, watchlistId)
    return buildWatchlistRecordFromDocument(buildRootWatchlistMetadata(scope.workspaceId), fields)
  } catch (error) {
    mapDocumentError(error)
  }
}
