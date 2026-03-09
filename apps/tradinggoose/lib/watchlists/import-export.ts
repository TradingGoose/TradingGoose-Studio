import { normalizeWatchlistItems } from '@/lib/watchlists/validation'
import type { ListingIdentity } from '@/lib/listing/identity'

const getListingIdentityKey = (listing: ListingIdentity) =>
  `${listing.listing_type}|${listing.listing_id}|${listing.base_id}|${listing.quote_id}`

export const extractWatchlistListingIdentities = (itemsInput: unknown): ListingIdentity[] => {
  const items = normalizeWatchlistItems(itemsInput)
  const listings: ListingIdentity[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (item.type !== 'listing') continue
    const key = getListingIdentityKey(item.listing)
    if (seen.has(key)) continue
    seen.add(key)
    listings.push(item.listing)
  }

  return listings
}

export const exportWatchlistItemsAsJson = (itemsInput: unknown): string =>
  JSON.stringify(extractWatchlistListingIdentities(itemsInput), null, 2)
