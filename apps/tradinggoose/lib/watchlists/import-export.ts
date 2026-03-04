import type { WatchlistItem } from '@/lib/watchlists/types'
import { normalizeWatchlistItems } from '@/lib/watchlists/validation'
import type { ListingIdentity } from '@/lib/listing/identity'

const cleanToken = (value: string) => value.trim().replace(/^['"]|['"]$/g, '')

export const parseWatchlistImportText = (content: string): string[] => {
  const tokens = content
    .split(/[\n,]+/g)
    .map(cleanToken)
    .filter((value) => value.length > 0)

  const seen = new Set<string>()
  const result: string[] = []
  for (const token of tokens) {
    const normalized = token.toUpperCase()
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(token)
  }

  return result
}

export const splitExchangeSymbol = (
  token: string
): { exchange: string | null; symbol: string } => {
  const normalized = cleanToken(token)
  const parts = normalized.split(':').map((entry) => entry.trim()).filter(Boolean)

  if (parts.length >= 2) {
    const exchange = parts[0]
    const symbol = parts.slice(1).join(':')
    return {
      exchange: exchange || null,
      symbol,
    }
  }

  return {
    exchange: null,
    symbol: normalized,
  }
}

export const exportWatchlistItemsAsText = (itemsInput: unknown): string => {
  const items = normalizeWatchlistItems(itemsInput)
  const symbols: string[] = []

  const toSymbol = (listing: ListingIdentity) =>
    listing.listing_type === 'default'
      ? listing.listing_id
      : `${listing.base_id}:${listing.quote_id}`

  for (const item of items) {
    if (item.type !== 'listing') continue
    const symbol = toSymbol(item.listing).trim()
    if (!symbol) continue
    symbols.push(symbol)
  }

  return symbols.join(',')
}

export const buildWatchlistImportText = (items: WatchlistItem[]): string =>
  exportWatchlistItemsAsText(items)
