import { db } from '@tradinggoose/db'
import { watchlistItem, watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { toListingValueObject } from '@/lib/listing/identity'
import type { ListingInputValue } from '@/lib/listing/identity'
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

type WatchlistRow = typeof watchlistTable.$inferSelect
type WatchlistItemRow = typeof watchlistItem.$inferSelect
export type WatchlistDocumentTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type CreatedWatchlistDocument = {
  id: string
  fields: WatchlistDocumentFields
  createdAt: Date | string
  updatedAt: Date | string
}

const ensureFound = <T>(row: T | undefined, message = 'Watchlist not found'): T => {
  if (!row) {
    throw new WatchlistDocumentError(message, 404)
  }
  return row
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('watchlist_table_workspace_root_name_unique') ||
    error.message.includes('watchlist_item_watchlist_listing_identity_unique') ||
    error.message.toLowerCase().includes('duplicate key'))

export const rootWatchlistCondition = (workspaceId: string, watchlistId?: string) => {
  const conditions = [
    eq(watchlistTable.workspaceId, workspaceId),
    isNull(watchlistTable.userId),
    isNull(watchlistTable.rootWatchlistId),
    isNull(watchlistTable.parentId),
  ]
  if (watchlistId) conditions.push(eq(watchlistTable.id, watchlistId))
  return and(...conditions)
}

export const fetchRootWatchlistRow = async (
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string
): Promise<WatchlistRow> => {
  const [row] = await tx
    .select()
    .from(watchlistTable)
    .where(rootWatchlistCondition(workspaceId, watchlistId))
    .limit(1)

  return ensureFound(row)
}

const loadWatchlistRows = async (tx: WatchlistDocumentTx, row: WatchlistRow) => {
  const [sections, items] = await Promise.all([
    tx
      .select()
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, row.workspaceId),
          isNull(watchlistTable.userId),
          eq(watchlistTable.rootWatchlistId, row.id),
          isNull(watchlistTable.parentId)
        )
      )
      .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.createdAt)),
    tx
      .select()
      .from(watchlistItem)
      .where(eq(watchlistItem.watchlistId, row.id))
      .orderBy(asc(watchlistItem.sortOrder), asc(watchlistItem.createdAt)),
  ])

  return { sections, items }
}

const mapListingRow = (row: WatchlistItemRow): WatchlistItem => {
  const listing = toListingValueObject(row.listing as ListingInputValue)
  if (!listing) {
    throw new WatchlistDocumentError('Invalid persisted watchlist listing')
  }

  return {
    id: row.id,
    type: 'listing',
    listing,
  }
}

const buildItemsBySectionMap = (items: WatchlistItemRow[]) => {
  const bySection = new Map<string, WatchlistItemRow[]>()
  const unsectioned: WatchlistItemRow[] = []

  for (const item of items) {
    if (!item.containerId) {
      unsectioned.push(item)
      continue
    }

    const bucket = bySection.get(item.containerId) ?? []
    bucket.push(item)
    bySection.set(item.containerId, bucket)
  }

  const bySort = (left: WatchlistItemRow, right: WatchlistItemRow) =>
    left.sortOrder - right.sortOrder || left.createdAt.getTime() - right.createdAt.getTime()

  bySection.forEach((bucket) => bucket.sort(bySort))
  unsectioned.sort(bySort)

  return { bySection, unsectioned }
}

export const composeWatchlistDocumentFromRows = (
  sections: WatchlistRow[],
  items: WatchlistItemRow[]
): WatchlistItem[] => {
  const output: WatchlistItem[] = []
  const { bySection: itemsBySection, unsectioned } = buildItemsBySectionMap(items)

  for (const row of unsectioned) {
    output.push(mapListingRow(row))
  }

  for (const section of sections) {
    output.push({
      id: section.id,
      type: 'section',
      label: section.name,
    })

    for (const row of itemsBySection.get(section.id) ?? []) {
      output.push(mapListingRow(row))
    }
  }

  return output
}

export const mapWatchlistDocumentFieldsInTx = async (
  tx: WatchlistDocumentTx,
  row: WatchlistRow
): Promise<WatchlistDocumentFields> => {
  const { sections, items } = await loadWatchlistRows(tx, row)
  const documentItems = composeWatchlistDocumentFromRows(sections, items)
  return normalizePersistedWatchlistDocumentFields({
    name: row.name,
    settings: row.settings,
    items: documentItems,
  })
}

const getNextRootSortOrder = async (tx: WatchlistDocumentTx, workspaceId: string) => {
  const [last] = await tx
    .select({ sortOrder: watchlistTable.sortOrder })
    .from(watchlistTable)
    .where(rootWatchlistCondition(workspaceId))
    .orderBy(desc(watchlistTable.sortOrder))
    .limit(1)

  return last ? last.sortOrder + 1 : 0
}

const itemId = (item: WatchlistDocumentInputItem) => item.id?.trim() || null

async function deleteWatchlistDocumentChildren(tx: WatchlistDocumentTx, rootId: string) {
  await tx.delete(watchlistItem).where(eq(watchlistItem.watchlistId, rootId))
  await tx
    .delete(watchlistTable)
    .where(
      and(
        eq(watchlistTable.rootWatchlistId, rootId),
        isNull(watchlistTable.userId),
        isNull(watchlistTable.parentId)
      )
    )
}

async function insertSection(
  tx: WatchlistDocumentTx,
  root: WatchlistRow,
  item: Extract<WatchlistDocumentInputItem, { type: 'section' }>,
  sortOrder: number
): Promise<string> {
  const submittedId = itemId(item)
  const [created] = await tx
    .insert(watchlistTable)
    .values({
      ...(submittedId ? { id: submittedId } : {}),
      workspaceId: root.workspaceId,
      userId: null,
      rootWatchlistId: root.id,
      parentId: null,
      name: item.label,
      sortOrder,
      settings: {},
      updatedAt: new Date(),
    })
    .returning()
  return ensureFound(created).id
}

async function insertListingItem(
  tx: WatchlistDocumentTx,
  root: WatchlistRow,
  item: Extract<WatchlistDocumentInputItem, { type: 'listing' }>,
  containerId: string | null,
  sortOrder: number
): Promise<string> {
  const submittedId = itemId(item)
  const [created] = await tx
    .insert(watchlistItem)
    .values({
      ...(submittedId ? { id: submittedId } : {}),
      watchlistId: root.id,
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
  const root = await fetchRootWatchlistRow(tx, workspaceId, watchlistId)

  try {
    await deleteWatchlistDocumentChildren(tx, root.id)

    const [updatedRoot] = await tx
      .update(watchlistTable)
      .set({
        name: fields.name,
        settings: fields.settings,
        updatedAt: new Date(),
      })
      .where(rootWatchlistCondition(workspaceId, watchlistId))
      .returning({ id: watchlistTable.id })
    ensureFound(updatedRoot, 'Watchlist document contains a stale root watchlist id')

    const persistedItems: WatchlistItem[] = []
    let activeSectionId: string | null = null
    let sectionSortOrder = 0
    const itemSortOrders = new Map<string, number>()
    const nextItemSortOrder = (containerId: string | null) => {
      const key = containerId ?? '__root__'
      const next = itemSortOrders.get(key) ?? 0
      itemSortOrders.set(key, next + 1)
      return next
    }

    for (const item of fields.items) {
      if (item.type === 'section') {
        activeSectionId = await insertSection(tx, root, item, sectionSortOrder)
        persistedItems.push({ id: activeSectionId, type: 'section', label: item.label })
        sectionSortOrder += 1
        continue
      }

      const persistedId = await insertListingItem(
        tx,
        root,
        item,
        activeSectionId,
        nextItemSortOrder(activeSectionId)
      )
      persistedItems.push({ id: persistedId, type: 'listing', listing: item.listing })
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

export async function createWatchlistDocumentInTx(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  rawFields: Record<string, unknown>
): Promise<CreatedWatchlistDocument> {
  const fields = normalizeWatchlistDocumentFields(rawFields)
  const sortOrder = await getNextRootSortOrder(tx, workspaceId)
  const [root] = await tx
    .insert(watchlistTable)
    .values({
      workspaceId,
      userId: null,
      rootWatchlistId: null,
      parentId: null,
      name: fields.name,
      sortOrder,
      settings: fields.settings,
      updatedAt: new Date(),
    })
    .returning()
  const rootRow = ensureFound(root)
  const persistedFields = await materializeWatchlistDocumentInTx(tx, workspaceId, rootRow.id, fields)
  const persistedRoot = await fetchRootWatchlistRow(tx, workspaceId, rootRow.id)
  return {
    id: persistedRoot.id,
    fields: persistedFields,
    createdAt: persistedRoot.createdAt,
    updatedAt: persistedRoot.updatedAt,
  }
}

export async function loadWatchlistDocumentFields(
  workspaceId: string,
  watchlistId: string
): Promise<WatchlistDocumentFields> {
  return db.transaction(async (tx) => {
    const row = await fetchRootWatchlistRow(tx, workspaceId, watchlistId)
    return mapWatchlistDocumentFieldsInTx(tx, row)
  })
}
