import {
  getListingIdentitySymbol,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'

export const resolveWatchlistValueColorClass = (value: number | null) => {
  if (value == null || Number.isNaN(value)) return 'text-muted-foreground'
  if (value > 0) return 'text-green-600'
  if (value < 0) return 'text-red-600'
  return 'text-foreground'
}

export const resolveWatchlistAssetClass = (
  listing: ListingIdentity,
  resolved?: ListingResolved | null
): string => {
  const fromResolved = resolved?.assetClass?.trim()
  if (fromResolved) return fromResolved.toUpperCase()
  if (listing.listing_type === 'crypto') return 'CRYPTO'
  if (listing.listing_type === 'currency') return 'CURRENCY'
  return 'DEFAULT'
}

export const resolveWatchlistListingLabel = (
  listing: ListingIdentity,
  resolved?: ListingResolved | null
) => {
  if (resolved) {
    const quote = resolved.quote?.trim()
    return quote ? `${resolved.base}/${quote}` : resolved.base
  }

  return getListingIdentitySymbol(listing)
}
