import { db } from '@tradinggoose/db'
import { watchlistItem, watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { toListingValueObject } from '@/lib/listing/identity'
import type { ListingInputValue } from '@/lib/listing/identity'
import { DEFAULT_WATCHLIST_SETTINGS } from '@/lib/watchlists/constants'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentFields,
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'
import type {
  WatchlistDocumentFields,
  WatchlistDocumentInputItem,
  WatchlistItem,
} from '@/lib/watchlists/types'

type WatchlistContainerRow = typeof watchlistTable.$inferSelect
type WatchlistItemRow = typeof watchlistItem.$inferSelect
export type WatchlistDocumentTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type WatchlistContainerKind = 'list' | 'section'
type WatchlistContainerInputItem = Extract<WatchlistDocumentInputItem, { type: 'list' }> | Extract<
  WatchlistDocumentInputItem,
  { type: 'section' }
>
type WatchlistContainerItem = Extract<WatchlistItem, { type: 'list' }> | Extract<
  WatchlistItem,
  { type: 'section' }
>

type RootWatchlistReference = {
  id: string
  workspaceId: string
  name: string
  settings: typeof DEFAULT_WATCHLIST_SETTINGS
  createdAt: Date
  updatedAt: Date
}

const ROOT_WATCHLIST_NAME = 'Watchlist'
const ROOT_TIMESTAMP = new Date(0)

const ensureFound = <T>(row: T | undefined, message = 'Watchlist not found'): T => {
  if (!row) {
    throw new WatchlistDocumentError(message, 404)
  }
  return row
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('watchlist_table_workspace_user_name_unique') ||
    error.message.includes('watchlist_item_watchlist_listing_identity_unique') ||
    error.message.toLowerCase().includes('duplicate key'))

export const workspaceContainerCondition = (workspaceId: string) =>
  and(eq(watchlistTable.workspaceId, workspaceId), isNull(watchlistTable.userId))

const rootItemCondition = (workspaceId: string) =>
  and(eq(watchlistItem.workspaceId, workspaceId), isNull(watchlistItem.userId))

function assertRootWatchlistId(workspaceId: string, watchlistId: string): RootWatchlistReference {
  if (watchlistId !== workspaceId) {
    throw new WatchlistDocumentError('Watchlist not found', 404)
  }

  return {
    id: watchlistId,
    workspaceId,
    name: ROOT_WATCHLIST_NAME,
    settings: DEFAULT_WATCHLIST_SETTINGS,
    createdAt: ROOT_TIMESTAMP,
    updatedAt: ROOT_TIMESTAMP,
  }
}

export const fetchRootWatchlistRow = async (
  _tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string
): Promise<RootWatchlistReference> => assertRootWatchlistId(workspaceId, watchlistId)

const loadWatchlistRows = async (tx: WatchlistDocumentTx, workspaceId: string) => {
  const [containers, items] = await Promise.all([
    tx
      .select()
      .from(watchlistTable)
      .where(workspaceContainerCondition(workspaceId))
      .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.createdAt)),
    tx
      .select()
      .from(watchlistItem)
      .where(rootItemCondition(workspaceId))
      .orderBy(asc(watchlistItem.sortOrder), asc(watchlistItem.createdAt)),
  ])

  return { containers, items }
}

const mapListingRow = (row: WatchlistItemRow): WatchlistItem => {
  const listing = toListingValueObject(row.listing as ListingInputValue)
  if (!listing) {
    throw new WatchlistDocumentError('Invalid persisted watchlist listing')
  }

  return {
    id: row.id,
    type: 'listing',
    parentId: row.containerId ?? null,
    listing,
  }
}

const ROOT_PARENT_KEY = '__root__'
const parentKey = (parentId: string | null | undefined) => parentId ?? ROOT_PARENT_KEY

const sortContainerRows = (left: WatchlistContainerRow, right: WatchlistContainerRow) =>
  left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime()

const sortItemRows = (left: WatchlistItemRow, right: WatchlistItemRow) =>
  left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime()

const groupRowsByParent = <T extends { parentId?: string | null; containerId?: string | null }>(
  rows: T[],
  readParentId: (row: T) => string | null | undefined
) => {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const key = parentKey(readParentId(row))
    grouped.set(key, [...(grouped.get(key) ?? []), row])
  }
  return grouped
}

export const composeWatchlistDocumentFromRows = (
  containers: WatchlistContainerRow[],
  items: WatchlistItemRow[]
): WatchlistItem[] => {
  const output: WatchlistItem[] = []
  const containersByParent = groupRowsByParent(containers, (container) => container.parentId)
  const itemsByParent = groupRowsByParent(items, (item) => item.containerId)

  containersByParent.forEach((rows) => rows.sort(sortContainerRows))
  itemsByParent.forEach((rows) => rows.sort(sortItemRows))

  const appendChildren = (parentId: string | null) => {
    for (const row of itemsByParent.get(parentKey(parentId)) ?? []) {
      output.push(mapListingRow(row))
    }

    for (const container of containersByParent.get(parentKey(parentId)) ?? []) {
      const type = readContainerKind(container)
      output.push(
        type === 'list'
          ? {
              id: container.id,
              type: 'list',
              parentId: null,
              label: container.name,
            }
          : {
              id: container.id,
              type: 'section',
              parentId: container.parentId ?? null,
              label: container.name,
            }
      )
      appendChildren(container.id)
    }
  }

  appendChildren(null)

  return output
}

export const mapWatchlistDocumentFieldsInTx = async (
  tx: WatchlistDocumentTx,
  root: RootWatchlistReference
): Promise<WatchlistDocumentFields> => {
  const { containers, items } = await loadWatchlistRows(tx, root.workspaceId)
  const documentItems = composeWatchlistDocumentFromRows(containers, items)
  return normalizePersistedWatchlistDocumentFields({
    name: root.name,
    settings: root.settings,
    items: documentItems,
  })
}

const itemId = (item: WatchlistDocumentInputItem) => item.id?.trim() || null

async function deleteWatchlistDocumentChildren(tx: WatchlistDocumentTx, workspaceId: string) {
  await tx.delete(watchlistItem).where(rootItemCondition(workspaceId))
  await tx.delete(watchlistTable).where(workspaceContainerCondition(workspaceId))
}

function readContainerKind(row: WatchlistContainerRow): WatchlistContainerKind {
  const settings = row.settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new WatchlistDocumentError('Invalid persisted watchlist container kind')
  }

  const kind = (settings as Record<string, unknown>).kind
  if (kind !== 'list' && kind !== 'section') {
    throw new WatchlistDocumentError('Invalid persisted watchlist container kind')
  }

  return kind
}

async function insertContainer(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  item: WatchlistContainerInputItem,
  parentId: string | null,
  sortOrder: number
): Promise<string> {
  const submittedId = itemId(item)
  const [created] = await tx
    .insert(watchlistTable)
    .values({
      ...(submittedId ? { id: submittedId } : {}),
      workspaceId,
      userId: null,
      parentId,
      name: item.label,
      sortOrder,
      settings: { kind: item.type },
      updatedAt: new Date(),
    })
    .returning()
  return ensureFound(created).id
}

async function insertListingItem(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  item: Extract<WatchlistDocumentInputItem, { type: 'listing' }>,
  containerId: string | null,
  sortOrder: number
): Promise<string> {
  const submittedId = itemId(item)
  const [created] = await tx
    .insert(watchlistItem)
    .values({
      ...(submittedId ? { id: submittedId } : {}),
      workspaceId,
      userId: null,
      watchlistId: null,
      containerId,
      listing: item.listing,
      sortOrder,
    })
    .returning()
  return ensureFound(created).id
}

export async function materializeWatchlistDocumentInTx(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string,
  rawFields: Record<string, unknown>
): Promise<WatchlistDocumentFields> {
  const fields = normalizeWatchlistDocumentFields(rawFields)
  assertRootWatchlistId(workspaceId, watchlistId)

  try {
    await deleteWatchlistDocumentChildren(tx, workspaceId)

    const persistedItems: WatchlistItem[] = []

    const submittedContainerIds = new Set(
      fields.items
        .filter(
          (item): item is WatchlistContainerInputItem =>
            (item.type === 'list' || item.type === 'section') && Boolean(item.id)
        )
        .map((item) => item.id as string)
    )
    const persistedContainerIds = new Map<string, string>()
    const persistedContainers = new Map<
      WatchlistDocumentInputItem,
      WatchlistContainerItem
    >()
    const containerSortOrders = new Map<string, number>()
    const listingSortOrders = new Map<string, number>()
    const nextSortOrder = (orders: Map<string, number>, parentId: string | null) => {
      const key = parentKey(parentId)
      const next = orders.get(key) ?? 0
      orders.set(key, next + 1)
      return next
    }

    const pendingContainers = fields.items.filter(
      (item): item is WatchlistContainerInputItem =>
        item.type === 'list' || item.type === 'section'
    )

    while (pendingContainers.length > 0) {
      let insertedCount = 0

      for (let index = 0; index < pendingContainers.length; index += 1) {
        const item = pendingContainers[index]
        if (!item) continue
        const submittedParentId = item.parentId ?? null
        const parentId: string | null = submittedParentId
          ? (persistedContainerIds.get(submittedParentId) ?? null)
          : null

        if (submittedParentId && !parentId && submittedContainerIds.has(submittedParentId)) {
          continue
        }

        const persistedId = await insertContainer(
          tx,
          workspaceId,
          item,
          parentId,
          nextSortOrder(containerSortOrders, parentId)
        )
        if (item.id) {
          persistedContainerIds.set(item.id, persistedId)
        }
        persistedContainers.set(item, {
          id: persistedId,
          type: item.type,
          parentId: item.type === 'list' ? null : parentId,
          label: item.label,
        } as WatchlistContainerItem)
        pendingContainers.splice(index, 1)
        index -= 1
        insertedCount += 1
      }

      if (insertedCount === 0) {
        throw new WatchlistDocumentError('Watchlist container parentId cycle detected')
      }
    }

    for (const item of fields.items) {
      if (item.type === 'list' || item.type === 'section') {
        const persistedContainer = persistedContainers.get(item)
        if (persistedContainer) {
          persistedItems.push(persistedContainer)
        }
        continue
      }

      const containerId = item.parentId ? (persistedContainerIds.get(item.parentId) ?? null) : null
      const persistedId = await insertListingItem(
        tx,
        workspaceId,
        item,
        containerId,
        nextSortOrder(listingSortOrders, containerId)
      )
      persistedItems.push({
        id: persistedId,
        type: 'listing',
        parentId: containerId,
        listing: item.listing,
      })
    }

    return normalizePersistedWatchlistDocumentFields({
      name: fields.name,
      settings: fields.settings,
      items: persistedItems,
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WatchlistDocumentError('A watchlist with this name or listing already exists', 409)
    }
    throw error
  }
}

export async function loadWatchlistDocumentFields(
  workspaceId: string,
  watchlistId: string
): Promise<WatchlistDocumentFields> {
  return db.transaction(async (tx) => {
    const root = await fetchRootWatchlistRow(tx, workspaceId, watchlistId)
    return mapWatchlistDocumentFieldsInTx(tx, root)
  })
}
