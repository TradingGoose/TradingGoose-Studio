import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import { MAX_SYMBOLS_PER_WATCHLIST } from '@/lib/watchlists/constants'
import type {
  WatchlistDocumentInputItem,
  WatchlistDocumentListingInputItem,
} from '@/lib/watchlists/document'
import type {
  WatchlistItem,
  WatchlistSettings,
} from '@/lib/watchlists/types'

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const hasOnlyKeys = (value: Record<string, unknown>, allowedKeys: Set<string>) =>
  Object.keys(value).every((key) => allowedKeys.has(key))

const listingItemKeys = new Set(['id', 'type', 'listing'])
const sectionItemKeys = new Set(['id', 'type', 'label'])

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
  if (!hasOnlyKeys(value, sectionItemKeys)) return null

  const label = normalizeString(value.label)
  if (!label) return null

  return {
    ...(normalizeOptionalId(value.id) ? { id: normalizeOptionalId(value.id) } : {}),
    type: 'section',
    label,
  }
}

const normalizeWatchlistItem = (value: unknown): WatchlistItem | null => {
  if (!isPlainRecord(value)) return null
  const id = normalizeString(value.id)
  if (!id) return null

  const type = normalizeString(value.type)
  if (type === 'section') {
    if (!hasOnlyKeys(value, sectionItemKeys)) return null
    const label = normalizeString(value.label)
    if (!label) return null
    return {
      id,
      type: 'section',
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
