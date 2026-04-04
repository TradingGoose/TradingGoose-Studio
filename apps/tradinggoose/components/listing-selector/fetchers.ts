import type { ListingOption } from '@/lib/listing/identity'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'

export async function fetchListings(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingOption[]> {
  const query = new URLSearchParams(params)
  query.set('version', MARKET_API_VERSION)
  const response = await fetch(`/api/market/search?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as {
    data?: ListingOption[] | ListingOption | null
  }
  return normalizeListingOptions(payload)
}

export function normalizeListingOptions(payload: {
  data?: ListingOption[] | ListingOption | null
}): ListingOption[] {
  const rows = !payload?.data ? [] : Array.isArray(payload.data) ? payload.data : [payload.data]
  return rows.map((option) => normalizeListingOption(option))
}

function normalizeListingOption(option: ListingOption): ListingOption {
  const listingType = option.listing_type
  if (!listingType) {
    throw new Error('listing_type is required for listing results')
  }

  const listingId = option.listing_id ?? null
  const baseId = option.base_id ?? null
  const quoteId = option.quote_id ?? null
  const baseAssetClass = option.base_asset_class ?? null
  const quoteAssetClass = option.quote_asset_class ?? null

  if (listingType === 'default') {
    if (!listingId) {
      throw new Error('default listing results require listing_id')
    }
    return {
      ...option,
      listing_id: listingId,
      base_id: '',
      quote_id: '',
      listing_type: listingType,
      base_asset_class: baseAssetClass,
      quote_asset_class: quoteAssetClass,
    }
  }

  if (!baseId || !quoteId) {
    throw new Error('pair listing results require base_id and quote_id')
  }

  return {
    ...option,
    listing_id: '',
    base_id: baseId,
    quote_id: quoteId,
    listing_type: listingType,
    base_asset_class: baseAssetClass,
    quote_asset_class: quoteAssetClass,
  }
}
