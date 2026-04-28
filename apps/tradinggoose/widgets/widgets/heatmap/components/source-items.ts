import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import { MARKET_QUOTE_SNAPSHOT_REQUEST_CAP } from '@/lib/market/quote-snapshot-contract'
import type { WatchlistRecord } from '@/lib/watchlists/types'

export const HEATMAP_LISTING_CAP = MARKET_QUOTE_SNAPSHOT_REQUEST_CAP

export type HeatmapSourceListing = {
  key: string
  listing: ListingIdentity
  sourceLabels: string[]
}

export const capHeatmapListings = (
  items: HeatmapSourceListing[]
): {
  visibleItems: HeatmapSourceListing[]
  cappedCount: number
  totalCount: number
} => {
  const visibleItems = items.slice(0, HEATMAP_LISTING_CAP)
  return {
    visibleItems,
    cappedCount: Math.max(0, items.length - visibleItems.length),
    totalCount: items.length,
  }
}

export const resolveWatchlistHeatmapListings = (watchlists: WatchlistRecord[]) => {
  const byKey = new Map<string, HeatmapSourceListing>()

  for (const watchlist of watchlists) {
    const sourceLabel = watchlist.name.trim()

    for (const item of watchlist.items) {
      if (item.type !== 'listing') continue
      const listing = toListingValueObject(item.listing)
      if (!listing) continue
      const key = getListingIdentityKey(listing)
      const current = byKey.get(key)
      if (current) {
        if (sourceLabel && !current.sourceLabels.includes(sourceLabel)) {
          current.sourceLabels.push(sourceLabel)
        }
        continue
      }
      byKey.set(key, {
        key,
        listing,
        sourceLabels: sourceLabel ? [sourceLabel] : [],
      })
    }
  }

  return Array.from(byKey.values())
}

export const resolvePortfolioHeatmapListings = (
  listings: Array<ListingIdentity | null | undefined>
) => {
  const byKey = new Map<string, HeatmapSourceListing>()

  for (const listing of listings) {
    const normalized = toListingValueObject(listing)
    if (!normalized) continue
    const key = getListingIdentityKey(normalized)
    if (byKey.has(key)) continue
    byKey.set(key, {
      key,
      listing: normalized,
      sourceLabels: ['Portfolio'],
    })
  }

  return Array.from(byKey.values())
}
