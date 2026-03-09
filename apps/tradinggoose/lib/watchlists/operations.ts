import { db } from '@tradinggoose/db'
import { watchlistItem, watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { areListingIdentitiesEqual, toListingValueObject } from '@/lib/listing/identity'
import { DEFAULT_WATCHLIST_NAME, MAX_SYMBOLS_PER_WATCHLIST } from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'
import {
  isProtectedWatchlistName,
  normalizeWatchlistName,
  normalizeWatchlistSettings,
} from '@/lib/watchlists/validation'

type WatchlistScope = {
  workspaceId: string
  userId: string
}

type WatchlistRow = typeof watchlistTable.$inferSelect
type WatchlistItemRow = typeof watchlistItem.$inferSelect

type WatchlistTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

const UNSECTIONED = '__unsectioned__'

export class WatchlistOperationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WatchlistOperationError'
    this.status = status
  }
}

const mapWatchlistRow = (row: WatchlistRow, items: WatchlistItem[]): WatchlistRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  userId: row.userId,
  name: row.name,
  isSystem: row.isSystem,
  items,
  settings: normalizeWatchlistSettings(row.settings),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const isUniqueViolation = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('watchlist_table_workspace_user_name_unique') ||
    error.message.includes('watchlist_item_watchlist_listing_identity_unique') ||
    error.message.toLowerCase().includes('duplicate key'))

const ensureFound = (row: WatchlistRow | undefined) => {
  if (!row) {
    throw new WatchlistOperationError('Watchlist not found', 404)
  }
  return row
}

const fetchWatchlistRow = async (
  tx: WatchlistTx,
  watchlistId: string,
  scope: WatchlistScope
): Promise<WatchlistRow> => {
  const [row] = await tx
    .select()
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.id, watchlistId),
        eq(watchlistTable.workspaceId, scope.workspaceId),
        eq(watchlistTable.userId, scope.userId),
        isNull(watchlistTable.parentId)
      )
    )
    .limit(1)

  return ensureFound(row)
}

const loadWatchlistRows = async (tx: WatchlistTx, row: WatchlistRow) => {
  const [sections, items] = await Promise.all([
    tx
      .select()
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, row.workspaceId),
          eq(watchlistTable.userId, row.userId),
          eq(watchlistTable.parentId, row.id)
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

const mapListingRow = (row: WatchlistItemRow): WatchlistItem | null => {
  const listing = toListingValueObject(row.listing as ListingInputValue)
  if (!listing) return null

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

  bySection.forEach((bucket) => {
    bucket.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return a.sortOrder - b.sortOrder
      }
      return a.createdAt.getTime() - b.createdAt.getTime()
    })
  })

  unsectioned.sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })

  return { bySection, unsectioned }
}

const composeWatchlistItems = (sections: WatchlistRow[], items: WatchlistItemRow[]): WatchlistItem[] => {
  const output: WatchlistItem[] = []
  const sortedSections = [...sections].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder
    }
    return a.createdAt.getTime() - b.createdAt.getTime()
  })
  const { bySection: itemsBySection, unsectioned } = buildItemsBySectionMap(items)

  for (const row of unsectioned) {
    const listingItem = mapListingRow(row)
    if (listingItem) {
      output.push(listingItem)
    }
  }

  for (const section of sortedSections) {
    output.push({
      id: section.id,
      type: 'section',
      label: section.name,
    })

    for (const row of itemsBySection.get(section.id) ?? []) {
      const listingItem = mapListingRow(row)
      if (listingItem) {
        output.push(listingItem)
      }
    }
  }

  return output
}

const touchWatchlist = async (tx: WatchlistTx, watchlistId: string): Promise<WatchlistRow> => {
  const [updated] = await tx
    .update(watchlistTable)
    .set({
      updatedAt: new Date(),
    })
    .where(and(eq(watchlistTable.id, watchlistId), isNull(watchlistTable.parentId)))
    .returning()

  return ensureFound(updated)
}

const mapRecordInTx = async (tx: WatchlistTx, row: WatchlistRow): Promise<WatchlistRecord> => {
  const { sections, items } = await loadWatchlistRows(tx, row)
  return mapWatchlistRow(row, composeWatchlistItems(sections, items))
}

const getNextRootSortOrder = async (tx: WatchlistTx, scope: WatchlistScope) => {
  const [last] = await tx
    .select({ sortOrder: watchlistTable.sortOrder })
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.workspaceId, scope.workspaceId),
        eq(watchlistTable.userId, scope.userId),
        isNull(watchlistTable.parentId)
      )
    )
    .orderBy(desc(watchlistTable.sortOrder))
    .limit(1)

  return last ? last.sortOrder + 1 : 0
}

const getNextSortOrderForSection = async (tx: WatchlistTx, row: WatchlistRow) => {
  const [last] = await tx
    .select({ sortOrder: watchlistTable.sortOrder })
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.workspaceId, row.workspaceId),
        eq(watchlistTable.userId, row.userId),
        eq(watchlistTable.parentId, row.id)
      )
    )
    .orderBy(desc(watchlistTable.sortOrder))
    .limit(1)

  return last ? last.sortOrder + 1 : 0
}

const getNextSortOrderForItem = async (
  tx: WatchlistTx,
  watchlistId: string,
  containerId: string | null
) => {
  const [last] = await tx
    .select({ sortOrder: watchlistItem.sortOrder })
    .from(watchlistItem)
    .where(
      and(
        eq(watchlistItem.watchlistId, watchlistId),
        containerId ? eq(watchlistItem.containerId, containerId) : isNull(watchlistItem.containerId)
      )
    )
    .orderBy(desc(watchlistItem.sortOrder))
    .limit(1)

  return last ? last.sortOrder + 1 : 0
}

const hasListingIdentity = (items: WatchlistItemRow[], candidate: ListingIdentity) =>
  items.some((entry) => {
    const existing = toListingValueObject(entry.listing as ListingInputValue)
    return existing ? areListingIdentitiesEqual(existing, candidate) : false
  })

const ensureDefaultWatchlistInTx = async (tx: WatchlistTx, scope: WatchlistScope) => {
  const [existingSystem] = await tx
    .select()
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.workspaceId, scope.workspaceId),
        eq(watchlistTable.userId, scope.userId),
        eq(watchlistTable.isSystem, true),
        isNull(watchlistTable.parentId)
      )
    )
    .orderBy(asc(watchlistTable.createdAt))
    .limit(1)

  if (existingSystem) {
    if (existingSystem.name === DEFAULT_WATCHLIST_NAME) {
      return existingSystem
    }

    try {
      const [renamed] = await tx
        .update(watchlistTable)
        .set({
          name: DEFAULT_WATCHLIST_NAME,
          updatedAt: new Date(),
        })
        .where(and(eq(watchlistTable.id, existingSystem.id), isNull(watchlistTable.parentId)))
        .returning()
      return ensureFound(renamed)
    } catch (error) {
      if (isUniqueViolation(error)) {
        return existingSystem
      }
      throw error
    }
  }

  const sortOrder = await getNextRootSortOrder(tx, scope)
  const [created] = await tx
    .insert(watchlistTable)
    .values({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      parentId: null,
      name: DEFAULT_WATCHLIST_NAME,
      sortOrder,
      isSystem: true,
      settings: {},
      updatedAt: new Date(),
    })
    .returning()

  return ensureFound(created)
}

const ensureMutableList = (row: WatchlistRow, action: string) => {
  if (row.isSystem) {
    throw new WatchlistOperationError(
      `Cannot ${action} the protected ${DEFAULT_WATCHLIST_NAME}`,
      400
    )
  }
}

export async function listWatchlists(scope: WatchlistScope): Promise<WatchlistRecord[]> {
  return db.transaction(async (tx) => {
    await ensureDefaultWatchlistInTx(tx, scope)

    const rows = await tx
      .select()
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, scope.workspaceId),
          eq(watchlistTable.userId, scope.userId),
          isNull(watchlistTable.parentId)
        )
      )
      .orderBy(
        desc(watchlistTable.isSystem),
        asc(watchlistTable.name),
        asc(watchlistTable.createdAt)
      )

    if (rows.length === 0) {
      return []
    }

    const ids = rows.map((row) => row.id)
    const [sections, items] = await Promise.all([
      tx
        .select()
        .from(watchlistTable)
        .where(
          and(
            eq(watchlistTable.workspaceId, scope.workspaceId),
            eq(watchlistTable.userId, scope.userId),
            inArray(watchlistTable.parentId, ids)
          )
        )
        .orderBy(asc(watchlistTable.sortOrder), asc(watchlistTable.createdAt)),
      tx
        .select()
        .from(watchlistItem)
        .where(inArray(watchlistItem.watchlistId, ids))
        .orderBy(asc(watchlistItem.sortOrder), asc(watchlistItem.createdAt)),
    ])

    const sectionsByWatchlist = new Map<string, WatchlistRow[]>()
    const itemsByWatchlist = new Map<string, WatchlistItemRow[]>()

    for (const section of sections) {
      if (!section.parentId) continue
      const bucket = sectionsByWatchlist.get(section.parentId) ?? []
      bucket.push(section)
      sectionsByWatchlist.set(section.parentId, bucket)
    }

    for (const item of items) {
      const bucket = itemsByWatchlist.get(item.watchlistId) ?? []
      bucket.push(item)
      itemsByWatchlist.set(item.watchlistId, bucket)
    }

    return rows.map((row) =>
      mapWatchlistRow(
        row,
        composeWatchlistItems(
          sectionsByWatchlist.get(row.id) ?? [],
          itemsByWatchlist.get(row.id) ?? []
        )
      )
    )
  })
}

export async function getWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    return mapRecordInTx(tx, row)
  })
}

export async function createWatchlist(
  scope: WatchlistScope,
  rawName: string
): Promise<WatchlistRecord> {
  const name = normalizeWatchlistName(rawName)
  if (isProtectedWatchlistName(name)) {
    throw new WatchlistOperationError(`"${DEFAULT_WATCHLIST_NAME}" is reserved`, 400)
  }

  try {
    const sortOrder = await db.transaction((tx) => getNextRootSortOrder(tx, scope))
    const [created] = await db
      .insert(watchlistTable)
      .values({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        parentId: null,
        name,
        sortOrder,
        isSystem: false,
        settings: {},
        updatedAt: new Date(),
      })
      .returning()

    return mapWatchlistRow(ensureFound(created), [])
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WatchlistOperationError('A watchlist with this name already exists', 409)
    }
    throw error
  }
}

export async function renameWatchlist(
  scope: WatchlistScope,
  watchlistId: string,
  rawName: string
): Promise<WatchlistRecord> {
  const name = normalizeWatchlistName(rawName)
  if (isProtectedWatchlistName(name)) {
    throw new WatchlistOperationError(`"${DEFAULT_WATCHLIST_NAME}" is reserved`, 400)
  }

  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    ensureMutableList(row, 'rename')

    try {
      const [updated] = await tx
        .update(watchlistTable)
        .set({
          name,
          updatedAt: new Date(),
        })
        .where(and(eq(watchlistTable.id, row.id), isNull(watchlistTable.parentId)))
        .returning()

      return mapRecordInTx(tx, ensureFound(updated))
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WatchlistOperationError('A watchlist with this name already exists', 409)
      }
      throw error
    }
  })
}

export async function clearWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    ensureMutableList(row, 'clear')

    await tx.delete(watchlistItem).where(eq(watchlistItem.watchlistId, row.id))
    await tx
      .delete(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, row.workspaceId),
          eq(watchlistTable.userId, row.userId),
          eq(watchlistTable.parentId, row.id)
        )
      )

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function deleteWatchlist(scope: WatchlistScope, watchlistId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    ensureMutableList(row, 'delete')
    await tx.delete(watchlistTable).where(and(eq(watchlistTable.id, row.id), isNull(watchlistTable.parentId)))
  })
}

export async function updateWatchlistSettings(
  scope: WatchlistScope,
  watchlistId: string,
  settings: Partial<WatchlistSettings>
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const currentSettings = normalizeWatchlistSettings(row.settings)
    const nextSettings = normalizeWatchlistSettings({
      ...currentSettings,
      ...settings,
    })

    const [updated] = await tx
      .update(watchlistTable)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(and(eq(watchlistTable.id, row.id), isNull(watchlistTable.parentId)))
      .returning()

    return mapRecordInTx(tx, ensureFound(updated))
  })
}

export async function addListingToWatchlist(
  scope: WatchlistScope,
  watchlistId: string,
  listingInput: ListingIdentity
): Promise<WatchlistRecord> {
  const listing = toListingValueObject(listingInput)
  if (!listing) {
    throw new WatchlistOperationError('Invalid listing payload', 400)
  }

  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const { items } = await loadWatchlistRows(tx, row)

    if (hasListingIdentity(items, listing)) {
      return mapRecordInTx(tx, row)
    }

    if (items.length + 1 > MAX_SYMBOLS_PER_WATCHLIST) {
      throw new WatchlistOperationError(
        `Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`,
        400
      )
    }

    const sortOrder = await getNextSortOrderForItem(tx, row.id, null)

    try {
      await tx.insert(watchlistItem).values({
        watchlistId: row.id,
        containerId: null,
        listing,
        sortOrder,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error
      }
    }

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function addSectionToWatchlist(
  scope: WatchlistScope,
  watchlistId: string,
  labelInput: string
): Promise<WatchlistRecord> {
  const label = normalizeWatchlistName(labelInput)

  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const sortOrder = await getNextSortOrderForSection(tx, row)

    await tx.insert(watchlistTable).values({
      workspaceId: row.workspaceId,
      userId: row.userId,
      parentId: row.id,
      name: label,
      sortOrder,
      isSystem: false,
      settings: {},
      updatedAt: new Date(),
    })

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function renameWatchlistSection(
  scope: WatchlistScope,
  watchlistId: string,
  sectionId: string,
  labelInput: string
): Promise<WatchlistRecord> {
  const label = normalizeWatchlistName(labelInput)

  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const { sections } = await loadWatchlistRows(tx, row)

    const target = sections.find((section) => section.id === sectionId)
    if (!target) {
      return mapRecordInTx(tx, row)
    }

    if (target.name === label) {
      return mapRecordInTx(tx, row)
    }

    await tx
      .update(watchlistTable)
      .set({
        name: label,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(watchlistTable.id, sectionId),
          eq(watchlistTable.workspaceId, row.workspaceId),
          eq(watchlistTable.userId, row.userId),
          eq(watchlistTable.parentId, row.id)
        )
      )

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function removeWatchlistItem(
  scope: WatchlistScope,
  watchlistId: string,
  itemId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)

    await tx
      .delete(watchlistItem)
      .where(and(eq(watchlistItem.id, itemId), eq(watchlistItem.watchlistId, row.id)))

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function removeWatchlistSection(
  scope: WatchlistScope,
  watchlistId: string,
  sectionId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const { sections } = await loadWatchlistRows(tx, row)

    const target = sections.find((section) => section.id === sectionId)
    if (!target) {
      return mapRecordInTx(tx, row)
    }

    await tx
      .delete(watchlistItem)
      .where(
        and(eq(watchlistItem.watchlistId, row.id), eq(watchlistItem.containerId, sectionId))
      )

    await tx
      .delete(watchlistTable)
      .where(
        and(
          eq(watchlistTable.id, sectionId),
          eq(watchlistTable.workspaceId, row.workspaceId),
          eq(watchlistTable.userId, row.userId),
          eq(watchlistTable.parentId, row.id)
        )
      )

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function reorderWatchlistItems(
  scope: WatchlistScope,
  watchlistId: string,
  orderedItemIds: string[]
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const { sections, items } = await loadWatchlistRows(tx, row)

    const expectedSize = sections.length + items.length
    if (orderedItemIds.length !== expectedSize) {
      throw new WatchlistOperationError('Reorder payload must include all item ids', 400)
    }

    const sectionById = new Map(sections.map((section) => [section.id, section] as const))
    const itemById = new Map(items.map((item) => [item.id, item] as const))
    const seen = new Set<string>()

    for (const id of orderedItemIds) {
      if (seen.has(id)) {
        throw new WatchlistOperationError('Reorder payload contains duplicate item ids', 400)
      }
      seen.add(id)
      if (!sectionById.has(id) && !itemById.has(id)) {
        throw new WatchlistOperationError('Reorder payload contains unknown item id', 400)
      }
    }

    let currentSectionId: string | null = null
    let sectionOrder = 0
    const itemOrderBySection = new Map<string, number>()

    const nextOrder = (bucket: string) => {
      const next = itemOrderBySection.get(bucket) ?? 0
      itemOrderBySection.set(bucket, next + 1)
      return next
    }

    for (const id of orderedItemIds) {
      if (sectionById.has(id)) {
        currentSectionId = id
        await tx
          .update(watchlistTable)
          .set({
            sortOrder: sectionOrder,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(watchlistTable.id, id),
              eq(watchlistTable.workspaceId, row.workspaceId),
              eq(watchlistTable.userId, row.userId),
              eq(watchlistTable.parentId, row.id)
            )
          )
        sectionOrder += 1
        continue
      }

      const bucket = currentSectionId ?? UNSECTIONED
      const nextSortOrder = nextOrder(bucket)

      await tx
        .update(watchlistItem)
        .set({
          containerId: currentSectionId,
          sortOrder: nextSortOrder,
          updatedAt: new Date(),
        })
        .where(and(eq(watchlistItem.id, id), eq(watchlistItem.watchlistId, row.id)))
    }

    const updated = await touchWatchlist(tx, row.id)
    return mapRecordInTx(tx, updated)
  })
}

export async function appendListingsToWatchlist(
  scope: WatchlistScope,
  watchlistId: string,
  listings: ListingIdentity[]
): Promise<{ watchlist: WatchlistRecord; addedCount: number; skippedCount: number }> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const { items } = await loadWatchlistRows(tx, row)

    const existingListings = items
      .map((entry) => toListingValueObject(entry.listing as ListingInputValue))
      .filter((entry): entry is ListingIdentity => Boolean(entry))
    const additions: ListingIdentity[] = []

    let skippedCount = 0

    for (const candidate of listings) {
      const listing = toListingValueObject(candidate)
      const isDuplicate =
        listing &&
        (existingListings.some((entry) => areListingIdentitiesEqual(entry, listing)) ||
          additions.some((entry) => areListingIdentitiesEqual(entry, listing)))

      if (!listing || isDuplicate) {
        skippedCount += 1
        continue
      }

      additions.push(listing)
    }

    if (items.length + additions.length > MAX_SYMBOLS_PER_WATCHLIST) {
      throw new WatchlistOperationError(
        `Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`,
        400
      )
    }

    if (additions.length > 0) {
      const startSortOrder = await getNextSortOrderForItem(tx, row.id, null)

      await tx.insert(watchlistItem).values(
        additions.map((listing, index) => ({
          watchlistId: row.id,
          containerId: null,
          listing,
          sortOrder: startSortOrder + index,
        }))
      )
    }

    const updated = await touchWatchlist(tx, row.id)

    return {
      watchlist: await mapRecordInTx(tx, updated),
      addedCount: additions.length,
      skippedCount,
    }
  })
}
