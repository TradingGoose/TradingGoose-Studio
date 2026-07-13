import { db } from '@tradinggoose/db'
import { watchlistItem, watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, eq, isNull } from 'drizzle-orm'
import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import type {
  WatchlistDocumentContent,
  WatchlistDocumentFields,
  WatchlistDocumentInputItem,
  WatchlistItem,
  WatchlistSettings,
} from '@/lib/watchlists/types'
import {
  normalizePersistedWatchlistDocumentFields,
  normalizeWatchlistDocumentContent,
  normalizeWatchlistSettings,
  resolveWatchlistDocumentItemIds,
  WatchlistDocumentError,
} from '@/lib/watchlists/validation'

type WatchlistContainerRow = typeof watchlistTable.$inferSelect
type WatchlistItemRow = typeof watchlistItem.$inferSelect
export type WatchlistDocumentTx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type WatchlistContainerInputItem = Extract<WatchlistDocumentInputItem, { type: 'section' }>
type WatchlistSiblingRow =
  | { type: 'section'; row: WatchlistContainerRow }
  | { type: 'listing'; row: WatchlistItemRow }
export type WatchlistRootRow = WatchlistContainerRow & { settings: WatchlistSettings }

const ensureFound = <T>(row: T | undefined, message = 'Watchlist not found'): T => {
  if (!row) {
    throw new WatchlistDocumentError(message, 404)
  }
  return row
}

const isDuplicateListingViolation = (error: unknown) =>
  error instanceof Error &&
  error.message.includes('watchlist_item_watchlist_listing_identity_unique')

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

const watchlistItemUniquenessKey = (containerId: string | null, listing: ListingIdentity) =>
  `${containerId ?? ''}:${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`

const sortSiblingRows = (left: WatchlistSiblingRow, right: WatchlistSiblingRow) =>
  left.row.sortOrder - right.row.sortOrder ||
  left.row.createdAt.getTime() - right.row.createdAt.getTime() ||
  left.row.id.localeCompare(right.row.id)

export const composeWatchlistDocumentFromRows = (
  containers: WatchlistContainerRow[],
  items: WatchlistItemRow[],
  rootId: string
): WatchlistItem[] => {
  const sections = containers.filter((container) => container.parentId === rootId)
  const sectionIds = new Set(sections.map((section) => section.id))
  const nestedSection = containers.find(
    (container) => container.parentId != null && sectionIds.has(container.parentId)
  )
  if (nestedSection) {
    throw new WatchlistDocumentError('Persisted watchlist sections cannot be nested')
  }
  sections.forEach(readContainerKind)

  const listingsByContainer = new Map<string, WatchlistItemRow[]>()
  for (const item of items) {
    const containerId = item.containerId
    if (!containerId || (containerId !== rootId && !sectionIds.has(containerId))) {
      throw new WatchlistDocumentError('Persisted watchlist listing has an invalid container')
    }
    listingsByContainer.set(containerId, [...(listingsByContainer.get(containerId) ?? []), item])
  }

  const output: WatchlistItem[] = []
  const rootSiblings: WatchlistSiblingRow[] = [
    ...sections.map((row) => ({ type: 'section' as const, row })),
    ...(listingsByContainer.get(rootId) ?? []).map((row) => ({
      type: 'listing' as const,
      row,
    })),
  ].sort(sortSiblingRows)

  for (const sibling of rootSiblings) {
    if (sibling.type === 'listing') {
      output.push(mapListingRow(sibling.row, rootId))
      continue
    }
    const section = sibling.row
    output.push({ id: section.id, type: 'section', parentId: null, label: section.name })
    const sectionListings = (listingsByContainer.get(section.id) ?? [])
      .map((row) => ({ type: 'listing' as const, row }))
      .sort(sortSiblingRows)
    sectionListings.forEach((listing) => output.push(mapListingRow(listing.row, rootId)))
  }

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

async function persistContainer(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  item: WatchlistContainerInputItem & { id: string },
  parentId: string,
  sortOrder: number
): Promise<string> {
  const values = {
    workspaceId,
    userId: null,
    parentId,
    name: item.label,
    sortOrder,
    settings: { kind: item.type },
    updatedAt: new Date(),
  }
  const [updated] = await tx
    .update(watchlistTable)
    .set(values)
    .where(
      and(
        eq(watchlistTable.id, item.id),
        workspaceContainerCondition(workspaceId),
        eq(watchlistTable.parentId, parentId)
      )
    )
    .returning()
  if (updated) return updated.id

  const [created] = await tx
    .insert(watchlistTable)
    .values({
      id: item.id,
      ...values,
    })
    .returning()
  return ensureFound(created).id
}

async function persistListingItem(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string,
  item: Extract<WatchlistDocumentInputItem, { type: 'listing' }> & { id: string },
  containerId: string,
  sortOrder: number
): Promise<string> {
  const values = {
    workspaceId,
    userId: null,
    watchlistId,
    containerId,
    listing: item.listing,
    sortOrder,
    updatedAt: new Date(),
  }
  const [updated] = await tx
    .update(watchlistItem)
    .set(values)
    .where(and(documentItemCondition(workspaceId, watchlistId), eq(watchlistItem.id, item.id)))
    .returning()
  if (updated) return updated.id

  const [created] = await tx
    .insert(watchlistItem)
    .values({
      id: item.id,
      ...values,
    })
    .returning()
  return ensureFound(created).id
}

export async function materializeWatchlistDocumentInTx(
  tx: WatchlistDocumentTx,
  workspaceId: string,
  watchlistId: string,
  rawFields: Record<string, unknown>
): Promise<WatchlistDocumentContent> {
  const fields = normalizeWatchlistDocumentContent(rawFields)
  const currentRoot = await fetchRootWatchlistRow(tx, workspaceId, watchlistId)
  const currentRows = await loadWatchlistRows(tx, currentRoot)
  const currentSections = currentRows.containers.filter(
    (container) => container.parentId === currentRoot.id
  )
  currentSections.forEach(readContainerKind)
  const currentSectionIds = new Set(currentSections.map((section) => section.id))
  const currentListingIds = new Set(currentRows.items.map((item) => item.id))
  const resolvedItems = resolveWatchlistDocumentItemIds(fields.items)
  for (const item of resolvedItems) {
    if (item.type === 'section' && currentListingIds.has(item.id)) {
      throw new WatchlistDocumentError('Watchlist item id cannot change type')
    }
    if (item.type === 'listing' && currentSectionIds.has(item.id)) {
      throw new WatchlistDocumentError('Watchlist item id cannot change type')
    }
  }

  try {
    const [updatedRoot] = await tx
      .update(watchlistTable)
      .set({
        settings: fields.settings,
        updatedAt: new Date(),
      })
      .where(rootWatchlistCondition(workspaceId, watchlistId))
      .returning()

    const root = normalizeRootRow(ensureFound(updatedRoot))
    const siblingSortOrders = new Map<(typeof resolvedItems)[number], number>()
    const nextSiblingSortOrders = new Map<string, number>()
    for (const item of resolvedItems) {
      const key = item.parentId ?? root.id
      const next = nextSiblingSortOrders.get(key) ?? 0
      nextSiblingSortOrders.set(key, next + 1)
      siblingSortOrders.set(item, next)
    }
    const submittedSortOrder = (item: (typeof resolvedItems)[number]) =>
      siblingSortOrders.get(item) ?? 0

    const submittedSectionIds = new Set<string>()
    for (const item of resolvedItems) {
      if (item.type !== 'section') continue
      await persistContainer(tx, workspaceId, item, root.id, submittedSortOrder(item))
      submittedSectionIds.add(item.id)
    }

    const submittedListingKeys = new Map<string, string>()
    for (const item of resolvedItems) {
      if (item.type !== 'listing') continue
      const dbContainerId = item.parentId ?? root.id
      submittedListingKeys.set(item.id, watchlistItemUniquenessKey(dbContainerId, item.listing))
    }

    for (const item of currentRows.items) {
      const submittedKey = submittedListingKeys.get(item.id)
      const currentKey = submittedKey
        ? watchlistItemUniquenessKey(item.containerId, item.listing as ListingIdentity)
        : null
      if (submittedKey === currentKey) continue
      await tx
        .delete(watchlistItem)
        .where(and(documentItemCondition(workspaceId, root.id), eq(watchlistItem.id, item.id)))
    }
    for (const item of resolvedItems) {
      if (item.type !== 'listing') continue
      const dbContainerId = item.parentId ?? root.id
      await persistListingItem(
        tx,
        workspaceId,
        root.id,
        item,
        dbContainerId,
        submittedSortOrder(item)
      )
    }
    for (const section of currentSections) {
      if (submittedSectionIds.has(section.id)) continue
      await tx
        .delete(watchlistTable)
        .where(
          and(
            workspaceContainerCondition(workspaceId),
            eq(watchlistTable.parentId, root.id),
            eq(watchlistTable.id, section.id)
          )
        )
    }

    const { name: _name, ...content } = normalizePersistedWatchlistDocumentFields({
      name: root.name,
      settings: root.settings,
      items: resolvedItems,
    })
    return content
  } catch (error) {
    if (isDuplicateListingViolation(error)) {
      throw new WatchlistDocumentError('Watchlist contains a duplicate listing', 409)
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
