import { db } from '@tradinggoose/db'
import { watchlistTable } from '@tradinggoose/db/schema'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { ListingIdentity } from '@/lib/listing/identity'
import { resolveListingKey, toListingValueObject } from '@/lib/listing/identity'
import { DEFAULT_WATCHLIST_NAME, MAX_SYMBOLS_PER_WATCHLIST } from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistRecord, WatchlistSettings } from '@/lib/watchlists/types'
import {
  assertWatchlistSymbolLimit,
  countWatchlistSymbols,
  isProtectedWatchlistName,
  normalizeWatchlistItems,
  normalizeWatchlistName,
  normalizeWatchlistSettings,
} from '@/lib/watchlists/validation'

type WatchlistScope = {
  workspaceId: string
  userId: string
}

type WatchlistRow = typeof watchlistTable.$inferSelect

type WatchlistTx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class WatchlistOperationError extends Error {
  status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'WatchlistOperationError'
    this.status = status
  }
}

const mapWatchlistRow = (row: WatchlistRow): WatchlistRecord => ({
  id: row.id,
  workspaceId: row.workspaceId,
  userId: row.userId,
  name: row.name,
  isSystem: row.isSystem,
  items: normalizeWatchlistItems(row.items),
  settings: normalizeWatchlistSettings(row.settings),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

const isUniqueViolation = (error: unknown) =>
  error instanceof Error &&
  (error.message.includes('watchlist_table_workspace_user_name_unique') ||
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
        eq(watchlistTable.userId, scope.userId)
      )
    )
    .limit(1)

  return ensureFound(row)
}

const ensureDefaultWatchlistInTx = async (tx: WatchlistTx, scope: WatchlistScope) => {
  const [existingSystem] = await tx
    .select()
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.workspaceId, scope.workspaceId),
        eq(watchlistTable.userId, scope.userId),
        eq(watchlistTable.isSystem, true)
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
        .where(eq(watchlistTable.id, existingSystem.id))
        .returning()
      return ensureFound(renamed)
    } catch (error) {
      if (isUniqueViolation(error)) {
        return existingSystem
      }
      throw error
    }
  }

  const [created] = await tx
    .insert(watchlistTable)
    .values({
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      name: DEFAULT_WATCHLIST_NAME,
      isSystem: true,
      items: [],
      settings: {},
      updatedAt: new Date(),
    })
    .returning()

  return created
}

const ensureMutableList = (row: WatchlistRow, action: string) => {
  if (row.isSystem) {
    throw new WatchlistOperationError(
      `Cannot ${action} the protected ${DEFAULT_WATCHLIST_NAME}`,
      400
    )
  }
}

const updateItems = async (tx: WatchlistTx, row: WatchlistRow, items: WatchlistItem[]) => {
  assertWatchlistSymbolLimit(items)
  const [updated] = await tx
    .update(watchlistTable)
    .set({
      items,
      updatedAt: new Date(),
    })
    .where(eq(watchlistTable.id, row.id))
    .returning()

  return ensureFound(updated)
}

const buildListingItem = (listing: ListingIdentity): WatchlistItem => ({
  id: crypto.randomUUID(),
  type: 'listing',
  listing,
})

const listingIdentityKey = (listing: ListingIdentity) => resolveListingKey(listing) ?? ''

const listingItemKey = (item: WatchlistItem) =>
  item.type === 'listing' ? listingIdentityKey(item.listing) : ''

export async function listWatchlists(scope: WatchlistScope): Promise<WatchlistRecord[]> {
  return db.transaction(async (tx) => {
    await ensureDefaultWatchlistInTx(tx, scope)
    const rows = await tx
      .select()
      .from(watchlistTable)
      .where(
        and(
          eq(watchlistTable.workspaceId, scope.workspaceId),
          eq(watchlistTable.userId, scope.userId)
        )
      )
      .orderBy(
        desc(watchlistTable.isSystem),
        asc(watchlistTable.name),
        asc(watchlistTable.createdAt)
      )

    return rows.map(mapWatchlistRow)
  })
}

export async function getWatchlist(
  scope: WatchlistScope,
  watchlistId: string
): Promise<WatchlistRecord> {
  const [row] = await db
    .select()
    .from(watchlistTable)
    .where(
      and(
        eq(watchlistTable.id, watchlistId),
        eq(watchlistTable.workspaceId, scope.workspaceId),
        eq(watchlistTable.userId, scope.userId)
      )
    )
    .limit(1)

  return mapWatchlistRow(ensureFound(row))
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
    const [created] = await db
      .insert(watchlistTable)
      .values({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        name,
        isSystem: false,
        items: [],
        settings: {},
        updatedAt: new Date(),
      })
      .returning()

    return mapWatchlistRow(ensureFound(created))
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
        .where(eq(watchlistTable.id, row.id))
        .returning()

      return mapWatchlistRow(ensureFound(updated))
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
    const updated = await updateItems(tx, row, [])
    return mapWatchlistRow(updated)
  })
}

export async function deleteWatchlist(scope: WatchlistScope, watchlistId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    ensureMutableList(row, 'delete')
    await tx.delete(watchlistTable).where(eq(watchlistTable.id, row.id))
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
      .where(eq(watchlistTable.id, row.id))
      .returning()

    return mapWatchlistRow(ensureFound(updated))
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
    const currentItems = normalizeWatchlistItems(row.items)
    const incomingKey = listingIdentityKey(listing)
    if (!incomingKey) {
      throw new WatchlistOperationError('Invalid listing identity', 400)
    }

    const exists = currentItems.some((item) => listingItemKey(item) === incomingKey)
    if (exists) {
      return mapWatchlistRow(row)
    }

    const nextItems = [...currentItems, buildListingItem(listing)]
    const updated = await updateItems(tx, row, nextItems)
    return mapWatchlistRow(updated)
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
    const currentItems = normalizeWatchlistItems(row.items)
    const nextItems: WatchlistItem[] = [
      ...currentItems,
      {
        id: crypto.randomUUID(),
        type: 'section',
        label,
      },
    ]
    const updated = await updateItems(tx, row, nextItems)
    return mapWatchlistRow(updated)
  })
}

export async function removeWatchlistItem(
  scope: WatchlistScope,
  watchlistId: string,
  itemId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const currentItems = normalizeWatchlistItems(row.items)
    const nextItems = currentItems.filter((item) => item.id !== itemId)
    const updated = await updateItems(tx, row, nextItems)
    return mapWatchlistRow(updated)
  })
}

export async function removeWatchlistSection(
  scope: WatchlistScope,
  watchlistId: string,
  sectionId: string
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const currentItems = normalizeWatchlistItems(row.items)
    const sectionIndex = currentItems.findIndex(
      (item) => item.id === sectionId && item.type === 'section'
    )

    if (sectionIndex === -1) {
      return mapWatchlistRow(row)
    }

    let nextSectionIndex = currentItems.length
    for (let index = sectionIndex + 1; index < currentItems.length; index += 1) {
      if (currentItems[index]?.type === 'section') {
        nextSectionIndex = index
        break
      }
    }

    const nextItems = currentItems.filter(
      (_item, index) => index < sectionIndex || index >= nextSectionIndex
    )
    const updated = await updateItems(tx, row, nextItems)
    return mapWatchlistRow(updated)
  })
}

export async function reorderWatchlistItems(
  scope: WatchlistScope,
  watchlistId: string,
  orderedItemIds: string[]
): Promise<WatchlistRecord> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const currentItems = normalizeWatchlistItems(row.items)
    const byId = new Map(currentItems.map((item) => [item.id, item] as const))
    if (orderedItemIds.length !== currentItems.length) {
      throw new WatchlistOperationError('Reorder payload must include all item ids', 400)
    }

    const reordered: WatchlistItem[] = []
    for (const id of orderedItemIds) {
      const item = byId.get(id)
      if (!item) {
        throw new WatchlistOperationError('Reorder payload contains unknown item id', 400)
      }
      reordered.push(item)
    }

    const updated = await updateItems(tx, row, reordered)
    return mapWatchlistRow(updated)
  })
}

export async function appendListingsToWatchlist(
  scope: WatchlistScope,
  watchlistId: string,
  listings: ListingIdentity[]
): Promise<{ watchlist: WatchlistRecord; addedCount: number; skippedCount: number }> {
  return db.transaction(async (tx) => {
    const row = await fetchWatchlistRow(tx, watchlistId, scope)
    const currentItems = normalizeWatchlistItems(row.items)
    const nextItems = [...currentItems]
    const existingKeys = new Set(
      currentItems.map((item) => listingItemKey(item)).filter((value) => Boolean(value))
    )

    let addedCount = 0
    let skippedCount = 0

    for (const candidate of listings) {
      const listing = toListingValueObject(candidate)
      const key = listing ? listingIdentityKey(listing) : ''
      if (!listing || !key || existingKeys.has(key)) {
        skippedCount += 1
        continue
      }
      nextItems.push(buildListingItem(listing))
      existingKeys.add(key)
      addedCount += 1
    }

    if (countWatchlistSymbols(nextItems) > MAX_SYMBOLS_PER_WATCHLIST) {
      throw new WatchlistOperationError(
        `Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`,
        400
      )
    }

    const updated = await updateItems(tx, row, nextItems)
    return {
      watchlist: mapWatchlistRow(updated),
      addedCount,
      skippedCount,
    }
  })
}
