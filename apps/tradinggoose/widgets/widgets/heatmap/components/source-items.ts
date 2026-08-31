import { getListingIdentityKey, type ListingIdentity } from '@/lib/listing/identity'
import { MARKET_QUOTE_SNAPSHOT_REQUEST_CAP } from '@/lib/market/quote-snapshot-contract'
import type { WatchlistItem } from '@/lib/watchlists/types'

export const HEATMAP_LISTING_CAP = MARKET_QUOTE_SNAPSHOT_REQUEST_CAP

export type HeatmapSourceListing = {
  key: string
  listing: ListingIdentity
  sourceLabels: string[]
}

type WatchlistHeatmapSource = {
  id: string
  name: string
  items: WatchlistItem[]
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

export const resolveWatchlistHeatmapListings = (watchlists: WatchlistHeatmapSource[]) => {
  const byKey = new Map<string, HeatmapSourceListing>()

  for (const watchlist of watchlists) {
    const sourceLabel = watchlist.name.trim()

    for (const item of watchlist.items) {
      if (item.type !== 'listing') continue
      const listing = item.listing
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
    if (!listing) continue
    const key = getListingIdentityKey(listing)
    if (byKey.has(key)) continue
    byKey.set(key, {
      key,
      listing,
      sourceLabels: ['Portfolio'],
    })
  }

  return Array.from(byKey.values())
}
