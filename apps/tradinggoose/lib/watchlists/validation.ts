import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { getListingIdentityKey, toListingValueObject } from '@/lib/listing/identity'
import { MAX_SYMBOLS_PER_WATCHLIST } from '@/lib/watchlists/constants'
import type {
  WatchlistDocumentFields,
  WatchlistDocumentInputFields,
  WatchlistDocumentInputItem,
  WatchlistDocumentListingInputItem,
  WatchlistDocumentSectionInputItem,
} from '@/lib/watchlists/types'
import type { WatchlistItem, WatchlistSettings } from '@/lib/watchlists/types'

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const watchlistDocumentKeys = new Set(['name', 'settings', 'items'])

export class WatchlistDocumentError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
    this.name = 'WatchlistDocumentError'
  }
}

const normalizeString = (value: unknown) => {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed
}

export const normalizeWatchlistName = (value: unknown): string => {
  const normalized = normalizeString(value)
  if (!normalized) {
    throw new Error('Watchlist name is required')
  }
  return normalized
}

export const normalizeWatchlistSettings = (value: unknown): WatchlistSettings => {
  if (!isPlainRecord(value)) {
    throw new Error('Watchlist settings are required')
  }

  const { showLogo, showTicker, showDescription } = value
  if (
    typeof showLogo !== 'boolean' ||
    typeof showTicker !== 'boolean' ||
    typeof showDescription !== 'boolean'
  ) {
    throw new Error('Watchlist settings must include showLogo, showTicker, and showDescription')
  }

  return {
    showLogo,
    showTicker,
    showDescription,
  }
}

const normalizeListingIdentity = (value: unknown): ListingIdentity | null => {
  if (!isPlainRecord(value)) return null
  return toListingValueObject(value as ListingInputValue) ?? null
}

const normalizeOptionalId = (value: unknown): string | undefined => {
  const id = normalizeString(value)
  return id || undefined
}

const normalizeNullableParentId = (value: unknown): string | null => {
  if (value == null) return null
  const id = normalizeString(value)
  return id || null
}

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: Set<string>) =>
  Object.keys(value).every((key) => allowedKeys.has(key))

const listingItemKeys = new Set(['id', 'type', 'parentId', 'listing'])
const containerItemKeys = new Set(['id', 'type', 'parentId', 'label'])
const ROOT_PARENT_KEY = '__root__'
const parentKey = (parentId: string | null | undefined) => parentId ?? ROOT_PARENT_KEY

const normalizeWatchlistDocumentListingInputItem = (
  value: unknown
): WatchlistDocumentListingInputItem | null => {
  if (!isPlainRecord(value)) return null
  if (normalizeString(value.type) !== 'listing') return null
  if (!hasOnlyKeys(value, listingItemKeys)) return null

  const listing = normalizeListingIdentity(value.listing)
  if (!listing) return null

  return {
    ...(normalizeOptionalId(value.id) ? { id: normalizeOptionalId(value.id) } : {}),
    type: 'listing',
    parentId: normalizeNullableParentId(value.parentId),
    listing,
  }
}

const normalizeWatchlistDocumentInputItem = (value: unknown): WatchlistDocumentInputItem | null => {
  if (!isPlainRecord(value)) return null

  const type = normalizeString(value.type)
  if (type === 'listing') {
    return normalizeWatchlistDocumentListingInputItem(value)
  }

  if (type !== 'section') return null
  if (!hasOnlyKeys(value, containerItemKeys)) return null

  const label = normalizeString(value.label)
  if (!label) return null

  return {
    ...(normalizeOptionalId(value.id) ? { id: normalizeOptionalId(value.id) } : {}),
    type: 'section',
    parentId: normalizeNullableParentId(value.parentId),
    label,
  } satisfies WatchlistDocumentSectionInputItem
}

const normalizeWatchlistItem = (value: unknown): WatchlistItem | null => {
  if (!isPlainRecord(value)) return null
  const id = normalizeString(value.id)
  if (!id) return null

  const type = normalizeString(value.type)
  if (type === 'section') {
    if (!hasOnlyKeys(value, containerItemKeys)) return null
    const label = normalizeString(value.label)
    if (!label) return null
    return {
      id,
      type: 'section',
      parentId: normalizeNullableParentId(value.parentId),
      label,
    }
  }

  if (type === 'listing') {
    if (!hasOnlyKeys(value, listingItemKeys)) return null
    const listing = normalizeListingIdentity(value.listing)
    if (!listing) return null
    return {
      id,
      type: 'listing',
      parentId: normalizeNullableParentId(value.parentId),
      listing,
    }
  }

  return null
}

export const normalizeWatchlistItems = (value: unknown): WatchlistItem[] => {
  if (!Array.isArray(value)) return []
  const normalized: WatchlistItem[] = []
  for (const entry of value) {
    const item = normalizeWatchlistItem(entry)
    if (!item) continue
    normalized.push(item)
  }
  return normalized
}

export const normalizeWatchlistDocumentInputItems = (
  value: unknown
): WatchlistDocumentInputItem[] => {
  if (!Array.isArray(value)) return []

  const normalized: WatchlistDocumentInputItem[] = []
  for (const entry of value) {
    const item = normalizeWatchlistDocumentInputItem(entry)
    if (!item) continue
    normalized.push(item)
  }

  return normalized
}

const countWatchlistSymbols = (items: WatchlistItem[]) =>
  items.reduce((count, item) => (item.type === 'listing' ? count + 1 : count), 0)

export const assertWatchlistSymbolLimit = (items: WatchlistItem[]) => {
  const symbolCount = countWatchlistSymbols(items)
  if (symbolCount > MAX_SYMBOLS_PER_WATCHLIST) {
    throw new Error(`Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`)
  }
}

function assertNoDuplicateSubmittedIds(items: Array<{ id?: string }>): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (!item.id) continue
    if (seen.has(item.id)) {
      throw new WatchlistDocumentError('Watchlist document contains duplicate item ids')
    }
    seen.add(item.id)
  }
}

function assertNoDuplicateListings(items: Array<{
  type: string
  parentId?: string | null
  listing?: ListingIdentity
}>): void {
  const seen = new Set<string>()
  for (const item of items) {
    if (item.type !== 'listing' || !item.listing) continue
    const key = `${parentKey(item.parentId)}:${getListingIdentityKey(item.listing)}`
    if (seen.has(key)) {
      throw new WatchlistDocumentError('Listing already exists in watchlist', 409)
    }
    seen.add(key)
  }
}

function assertValidParentTree(
  items: Array<{ id?: string; type: string; parentId?: string | null }>
) {
  const sectionIds = new Set<string>()
  const containerParents = new Map<string, string | null>()

  for (const item of items) {
    if (item.type !== 'section' || !item.id) continue
    sectionIds.add(item.id)
    containerParents.set(item.id, item.parentId ?? null)
  }

  for (const item of items) {
    const parentId = item.parentId ?? null
    if (!parentId) continue
    if (!sectionIds.has(parentId)) {
      throw new WatchlistDocumentError('Watchlist item parentId must reference a section')
    }
    if (item.type === 'section' && item.id === parentId) {
      throw new WatchlistDocumentError('Watchlist container cannot reference itself as parent')
    }
  }

  for (const containerId of sectionIds) {
    const visited = new Set<string>()
    let currentParentId = containerParents.get(containerId) ?? null

    while (currentParentId) {
      if (currentParentId === containerId || visited.has(currentParentId)) {
        throw new WatchlistDocumentError('Watchlist container parentId cycle detected')
      }
      visited.add(currentParentId)
      currentParentId = containerParents.get(currentParentId) ?? null
    }
  }
}

function assertWatchlistDocumentSymbolLimit(items: WatchlistItem[]): void {
  try {
    assertWatchlistSymbolLimit(items)
  } catch (error) {
    throw new WatchlistDocumentError(
      error instanceof Error ? error.message : 'Watchlist symbol limit exceeded'
    )
  }
}

function assertOnlyWatchlistDocumentKeys(source: Record<string, unknown>): void {
  const unexpectedKey = Object.keys(source).find((key) => !watchlistDocumentKeys.has(key))
  if (unexpectedKey) {
    throw new WatchlistDocumentError(`Unsupported watchlist document field: ${unexpectedKey}`)
  }
}

function requireWatchlistDocumentRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new WatchlistDocumentError('Watchlist document fields must be an object')
  }
  return value
}

function normalizeInputItems(value: unknown): WatchlistDocumentInputItem[] {
  if (!Array.isArray(value)) {
    throw new WatchlistDocumentError('Watchlist items must be an array')
  }

  const normalized = normalizeWatchlistDocumentInputItems(value)
  if (normalized.length !== value.length) {
    throw new WatchlistDocumentError('Invalid watchlist item')
  }

  assertNoDuplicateSubmittedIds(normalized)
  assertNoDuplicateListings(normalized)
  assertValidParentTree(normalized)
  assertWatchlistDocumentSymbolLimit(
    normalized.filter(
      (item): item is Extract<WatchlistDocumentInputItem, { type: 'listing' }> =>
        item.type === 'listing'
    ) as unknown as WatchlistItem[]
  )
  return normalized
}

export function normalizeWatchlistDocumentFields(value: unknown): WatchlistDocumentInputFields {
  const source = requireWatchlistDocumentRecord(value)
  assertOnlyWatchlistDocumentKeys(source)
  return {
    name: normalizeWatchlistName(source.name),
    settings: normalizeWatchlistSettings(source.settings),
    items: normalizeInputItems(source.items),
  }
}

export function normalizePersistedWatchlistDocumentFields(value: unknown): WatchlistDocumentFields {
  const source = requireWatchlistDocumentRecord(value)
  assertOnlyWatchlistDocumentKeys(source)
  const name = normalizeWatchlistName(source.name)
  const settings = normalizeWatchlistSettings(source.settings)
  if (!Array.isArray(source.items)) {
    throw new WatchlistDocumentError('Watchlist items must be an array')
  }
  const items = normalizeWatchlistItems(source.items)

  if (items.length !== source.items.length) {
    throw new WatchlistDocumentError('Invalid persisted watchlist item')
  }

  assertNoDuplicateSubmittedIds(items)
  assertNoDuplicateListings(items)
  assertValidParentTree(items)
  assertWatchlistDocumentSymbolLimit(items)

  return { name, settings, items }
}
