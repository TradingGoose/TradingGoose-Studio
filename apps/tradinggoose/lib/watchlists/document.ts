import { db } from '@tradinggoose/db'
import { watchlistItem, watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { toListingValueObject } from '@/lib/listing/identity'
import type { ListingInputValue } from '@/lib/listing/identity'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentFields,
  normalizeWatchlistSettings,
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'
import type {
  WatchlistDocumentFields,
  WatchlistDocumentInputItem,
  WatchlistItem,
  WatchlistSettings,
} from '@/lib/watchlists/types'

type WatchlistContainerRow = typeof watchlistTable.$inferSelect
type WatchlistItemRow = typeof watchlistItem.$inferSelect
export type WatchlistDocumentTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type WatchlistContainerInputItem = Extract<WatchlistDocumentInputItem, { type: 'section' }>
type WatchlistContainerItem = Extract<WatchlistItem, { type: 'section' }>
export type WatchlistRootRow = WatchlistContainerRow & { settings: WatchlistSettings }

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

const workspaceRootWatchlistCondition = (workspaceId: string) =>
  and(
    eq(watchlistTable.workspaceId, workspaceId),
    isNull(watchlistTable.userId),
    isNull(watchlistTable.parentId)
  )

const rootWatchlistCondition = (workspaceId: string, watchlistId: string) =>
  and(
    eq(watchlistTable.id, watchlistId),
    eq(watchlistTable.workspaceId, workspaceId),
    isNull(watchlistTable.userId),
    isNull(watchlistTable.parentId)
  )

const documentItemCondition = (workspaceId: string, watchlistId: string) =>
  and(
    eq(watchlistItem.workspaceId, workspaceId),
    eq(watchlistItem.watchlistId, watchlistId),
    isNull(watchlistItem.userId)
  )

const normalizeRootRow = (row: WatchlistContainerRow): WatchlistRootRow => {
  try {
    return { ...row, settings: normalizeWatchlistSettings(row.settings) }
  } catch {
    throw new WatchlistDocumentError('Invalid persisted watchlist settings')
  }
}

export const fetchRootWatchlistRow = async (
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string
): Promise<WatchlistRootRow> => {
  const [row] = await tx
    .select()
    .from(watchlistTable)
    .where(rootWatchlistCondition(workspaceId, watchlistId))
    .limit(1)

  return normalizeRootRow(ensureFound(row))
}

export const listRootWatchlistRowsInTx = async (
  tx: Pick<WatchlistDocumentTx, 'select'>,
  workspaceId: string
): Promise<WatchlistRootRow[]> => {
  const rows = await tx
    .select()
    .from(watchlistTable)
    .where(workspaceRootWatchlistCondition(workspaceId))
    .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.createdAt), asc(watchlistTable.id))

  return rows.map(normalizeRootRow)
}

const loadWatchlistRows = async (tx: WatchlistDocumentTx, root: WatchlistRootRow) => {
  const [containers, items] = await Promise.all([
    tx
      .select()
      .from(watchlistTable)
      .where(workspaceContainerCondition(root.workspaceId))
      .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.createdAt)),
    tx
      .select()
      .from(watchlistItem)
      .where(documentItemCondition(root.workspaceId, root.id))
      .orderBy(asc(watchlistItem.sortOrder), asc(watchlistItem.createdAt)),
  ])

  return { containers, items }
}

const mapListingRow = (row: WatchlistItemRow, rootId: string): WatchlistItem => {
  const listing = toListingValueObject(row.listing as ListingInputValue)
  if (!listing) {
    throw new WatchlistDocumentError('Invalid persisted watchlist listing')
  }

  return {
    id: row.id,
    type: 'listing',
    parentId: row.containerId === rootId ? null : (row.containerId ?? null),
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
  items: WatchlistItemRow[],
  rootId: string
): WatchlistItem[] => {
  const output: WatchlistItem[] = []
  const containersByParent = groupRowsByParent(containers, (container) => container.parentId)
  const itemsByParent = groupRowsByParent(items, (item) => item.containerId)

  containersByParent.forEach((rows) => rows.sort(sortContainerRows))
  itemsByParent.forEach((rows) => rows.sort(sortItemRows))

  const appendChildren = (parentId: string | null) => {
    for (const row of itemsByParent.get(parentKey(parentId)) ?? []) {
      output.push(mapListingRow(row, rootId))
    }

    for (const container of containersByParent.get(parentKey(parentId)) ?? []) {
      readContainerKind(container)
      output.push({
        id: container.id,
        type: 'section',
        parentId: container.parentId === rootId ? null : (container.parentId ?? null),
        label: container.name,
      })
      appendChildren(container.id)
    }
  }

  appendChildren(rootId)

  return output
}

export const mapWatchlistDocumentFieldsInTx = async (
  tx: WatchlistDocumentTx,
  root: WatchlistRootRow
): Promise<WatchlistDocumentFields> => {
  const { containers, items } = await loadWatchlistRows(tx, root)
  const documentItems = composeWatchlistDocumentFromRows(containers, items, root.id)
  return normalizePersistedWatchlistDocumentFields({
    name: root.name,
    settings: root.settings,
    items: documentItems,
  })
}

const itemId = (item: WatchlistDocumentInputItem) => item.id?.trim() || null

function collectDescendantContainerIds(
  containers: Array<{ id: string; parentId: string | null }>,
  rootId: string
): string[] {
  const childrenByParent = groupRowsByParent(containers, (container) => container.parentId)
  const descendantIds: string[] = []
  const queue = [...(childrenByParent.get(parentKey(rootId)) ?? [])]

  for (let index = 0; index < queue.length; index += 1) {
    const row = queue[index]
    if (!row) continue
    descendantIds.push(row.id)
    queue.push(...(childrenByParent.get(parentKey(row.id)) ?? []))
  }

  return descendantIds
}

async function deleteWatchlistDocumentChildren(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string
) {
  const containers = await tx
    .select({ id: watchlistTable.id, parentId: watchlistTable.parentId })
    .from(watchlistTable)
    .where(workspaceContainerCondition(workspaceId))

  const descendantContainerIds = collectDescendantContainerIds(containers, watchlistId)

  await tx.delete(watchlistItem).where(documentItemCondition(workspaceId, watchlistId))
  if (descendantContainerIds.length > 0) {
    await tx
      .delete(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, workspaceId),
          isNull(watchlistTable.userId),
          inArray(watchlistTable.id, descendantContainerIds)
        )
      )
  }
}

function readContainerKind(row: WatchlistContainerRow): void {
  const settings = row.settings
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    throw new WatchlistDocumentError('Invalid persisted watchlist container kind')
  }

  const kind = (settings as Record<string, unknown>).kind
  if (kind !== 'section') {
    throw new WatchlistDocumentError('Invalid persisted watchlist container kind')
  }
}

async function insertContainer(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  item: WatchlistContainerInputItem,
  parentId: string,
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
  watchlistId: string,
  item: Extract<WatchlistDocumentInputItem, { type: 'listing' }>,
  containerId: string,
  sortOrder: number
): Promise<string> {
  const submittedId = itemId(item)
  const [created] = await tx
    .insert(watchlistItem)
    .values({
      ...(submittedId ? { id: submittedId } : {}),
      workspaceId,
      userId: null,
      watchlistId,
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
  await fetchRootWatchlistRow(tx, workspaceId, watchlistId)

  try {
    const [updatedRoot] = await tx
      .update(watchlistTable)
      .set({
        name: fields.name,
        settings: fields.settings,
        updatedAt: new Date(),
      })
      .where(rootWatchlistCondition(workspaceId, watchlistId))
      .returning()

    const root = normalizeRootRow(ensureFound(updatedRoot))
    await deleteWatchlistDocumentChildren(tx, workspaceId, root.id)

    const persistedItems: WatchlistItem[] = []

    const submittedContainerIds = new Set(
      fields.items
        .filter(
          (item): item is WatchlistContainerInputItem =>
            item.type === 'section' && Boolean(item.id)
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
      (item): item is WatchlistContainerInputItem => item.type === 'section'
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
        const dbParentId = parentId ?? root.id

        if (submittedParentId && !parentId && submittedContainerIds.has(submittedParentId)) {
          continue
        }

        const persistedId = await insertContainer(
          tx,
          workspaceId,
          item,
          dbParentId,
          nextSortOrder(containerSortOrders, parentId)
        )
        if (item.id) {
          persistedContainerIds.set(item.id, persistedId)
        }
        persistedContainers.set(item, {
          id: persistedId,
          type: 'section',
          parentId,
          label: item.label,
        })
        pendingContainers.splice(index, 1)
        index -= 1
        insertedCount += 1
      }

      if (insertedCount === 0) {
        throw new WatchlistDocumentError('Watchlist container parentId cycle detected')
      }
    }

    for (const item of fields.items) {
      if (item.type === 'section') {
        const persistedContainer = persistedContainers.get(item)
        if (persistedContainer) {
          persistedItems.push(persistedContainer)
        }
        continue
      }

      const containerId = item.parentId ? (persistedContainerIds.get(item.parentId) ?? null) : null
      const dbContainerId = containerId ?? root.id
      const persistedId = await insertListingItem(
        tx,
        workspaceId,
        root.id,
        item,
        dbContainerId,
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
      name: root.name,
      settings: root.settings,
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
