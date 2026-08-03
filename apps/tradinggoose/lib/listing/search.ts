import { type ListingResolved, ListingResolvedSchema } from '@/lib/listing/identity'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { getBaseUrl } from '@/lib/urls/utils'

function buildMarketSearchUrl(params: Record<string, string>): string {
  const query = new URLSearchParams(params)
  query.set('version', MARKET_API_VERSION)
  const relativeUrl = `/api/market/search?${query.toString()}`
  if (typeof window !== 'undefined') {
    return relativeUrl
  }

  return new URL(relativeUrl, getBaseUrl()).toString()
}

export async function fetchListings(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingResolved[]> {
  const response = await fetch(buildMarketSearchUrl(params), { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as {
    data?: MarketListingSearchRow[] | MarketListingSearchRow | null
  }
  return normalizeResolvedListings(payload)
}

export type MarketListingSearchRow = Record<string, unknown>

export function normalizeResolvedListings(payload: {
  data?: MarketListingSearchRow[] | MarketListingSearchRow | null
}): ListingResolved[] {
  const rows = !payload?.data ? [] : Array.isArray(payload.data) ? payload.data : [payload.data]
  return rows.map(normalizeResolvedListing)
}

function normalizeResolvedListing({
  listing_id,
  base_id,
  quote_id,
  listing_type,
  rank: _rank,
  ...details
}: MarketListingSearchRow): ListingResolved {
  return ListingResolvedSchema.parse({
    ...details,
    listingIdentity: {
      listing_id: listing_id ?? '',
      base_id: base_id ?? '',
      quote_id: quote_id ?? '',
      listing_type,
    },
  })
}
