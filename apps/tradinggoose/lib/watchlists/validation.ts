import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'
import {
  DEFAULT_WATCHLIST_NAME,
  DEFAULT_WATCHLIST_SETTINGS,
  LEGACY_DEFAULT_WATCHLIST_NAME,
  MAX_SYMBOLS_PER_WATCHLIST,
} from '@/lib/watchlists/constants'
import type { WatchlistItem, WatchlistSettings } from '@/lib/watchlists/types'

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

const PROTECTED_WATCHLIST_NAMES = [DEFAULT_WATCHLIST_NAME, LEGACY_DEFAULT_WATCHLIST_NAME].map(
  (name) => name.toLowerCase()
)

export const isProtectedWatchlistName = (value: string): boolean =>
  PROTECTED_WATCHLIST_NAMES.includes(value.trim().toLowerCase())

export const normalizeWatchlistSettings = (value: unknown): WatchlistSettings => {
  if (!isPlainRecord(value)) {
    return {
      ...DEFAULT_WATCHLIST_SETTINGS,
    }
  }

  return {
    showLogo:
      typeof value.showLogo === 'boolean' ? value.showLogo : DEFAULT_WATCHLIST_SETTINGS.showLogo,
    showTicker:
      typeof value.showTicker === 'boolean'
        ? value.showTicker
        : DEFAULT_WATCHLIST_SETTINGS.showTicker,
    showDescription:
      typeof value.showDescription === 'boolean'
        ? value.showDescription
        : DEFAULT_WATCHLIST_SETTINGS.showDescription,
  }
}

const normalizeListingIdentity = (value: unknown): ListingIdentity | null => {
  if (!isPlainRecord(value)) return null
  return toListingValueObject(value as ListingInputValue) ?? null
}

const normalizeWatchlistItem = (value: unknown): WatchlistItem | null => {
  if (!isPlainRecord(value)) return null
  const id = normalizeString(value.id)
  if (!id) return null

  const type = normalizeString(value.type)
  if (type === 'section') {
    const label = normalizeString(value.label)
    if (!label) return null
    return {
      id,
      type: 'section',
      label,
    }
  }

  if (type === 'listing') {
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

export const countWatchlistSymbols = (items: WatchlistItem[]) =>
  items.reduce((count, item) => (item.type === 'listing' ? count + 1 : count), 0)

export const assertWatchlistSymbolLimit = (items: WatchlistItem[]) => {
  const symbolCount = countWatchlistSymbols(items)
  if (symbolCount > MAX_SYMBOLS_PER_WATCHLIST) {
    throw new Error(`Watchlist cannot contain more than ${MAX_SYMBOLS_PER_WATCHLIST} symbols`)
  }
}
