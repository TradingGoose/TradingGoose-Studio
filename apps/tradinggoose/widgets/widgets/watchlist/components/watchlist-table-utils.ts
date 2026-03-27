import type { ListingIdentity, ListingOption } from '@/lib/listing/identity'

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
