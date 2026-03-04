import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'
import type { WatchlistColumnKey, WatchlistSort } from '@/lib/watchlists/types'
import type { WatchlistQuoteSnapshot } from '@/hooks/queries/watchlist-quotes'

export type SortableListingRow = {
  listing: ListingIdentity
  itemId: string
}

export const resolveWatchlistValueColorClass = (value: number | null) => {
  if (value == null || Number.isNaN(value)) return 'text-muted-foreground'
  if (value > 0) return 'text-green-600'
  if (value < 0) return 'text-red-600'
  return 'text-foreground'
}

export const resolveWatchlistAssetClass = (
  listing: ListingIdentity,
  resolved?: ListingOption | null
): string => {
  const fromResolved = resolved?.assetClass?.trim()
  if (fromResolved) return fromResolved.toUpperCase()
  if (listing.listing_type === 'crypto') return 'CRYPTO'
  if (listing.listing_type === 'currency') return 'CURRENCY'
  return 'DEFAULT'
}

export const resolveWatchlistListingLabel = (
  listing: ListingIdentity,
  resolved?: ListingOption | null
) => {
  const base = resolved?.base?.trim() || ''
  const quote = resolved?.quote?.trim() || ''
  if (base) {
    return quote ? `${base}/${quote}` : base
  }

  if (listing.listing_type === 'default') {
    return listing.listing_id
  }
  return `${listing.base_id}/${listing.quote_id}`
}

export const sortWatchlistRowsByColumn = <TRow extends SortableListingRow>(
  rows: TRow[],
  sort: WatchlistSort,
  quotes: Record<string, WatchlistQuoteSnapshot>,
  resolved: Record<string, ListingOption | null>
) => {
  const direction = sort.direction === 'asc' ? 1 : -1

  const numeric = (itemId: string, column: WatchlistColumnKey) => {
    const quote = quotes[itemId]
    if (!quote) return Number.NEGATIVE_INFINITY
    if (column === 'lastPrice') return quote.lastPrice ?? Number.NEGATIVE_INFINITY
    if (column === 'change') return quote.change ?? Number.NEGATIVE_INFINITY
    if (column === 'changePercent') return quote.changePercent ?? Number.NEGATIVE_INFINITY
    return Number.NEGATIVE_INFINITY
  }

  return [...rows].sort((a, b) => {
    if (sort.column === 'listing') {
      const left = resolveWatchlistListingLabel(a.listing, resolved[a.itemId]).toLowerCase()
      const right = resolveWatchlistListingLabel(b.listing, resolved[b.itemId]).toLowerCase()
      return left.localeCompare(right) * direction
    }

    if (sort.column === 'assetClass') {
      const left = resolveWatchlistAssetClass(a.listing, resolved[a.itemId]).toLowerCase()
      const right = resolveWatchlistAssetClass(b.listing, resolved[b.itemId]).toLowerCase()
      return left.localeCompare(right) * direction
    }

    return (numeric(a.itemId, sort.column) - numeric(b.itemId, sort.column)) * direction
  })
}
