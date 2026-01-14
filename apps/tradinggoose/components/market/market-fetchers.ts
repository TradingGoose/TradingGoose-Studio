import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import type { ListingOption } from '@/lib/market/listings'

export async function fetchListings(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingOption[]> {
  const query = new URLSearchParams(params)
  query.set('version', MARKET_API_VERSION)
  const response = await fetch(`/api/market/search/listings?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as {
    data?: ListingOption[] | ListingOption | null
  }
  const rows = !payload?.data
    ? []
    : Array.isArray(payload.data)
      ? payload.data
      : [payload.data]
  return rows.map((option) => normalizeListingOption(option))
}

export async function fetchEquity(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingOption[]> {
  const query = new URLSearchParams(params)
  query.set('version', MARKET_API_VERSION)
  const response = await fetch(`/api/market/search/equity?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as {
    data?: ListingOption[] | ListingOption | null
  }
  const rows = !payload?.data
    ? []
    : Array.isArray(payload.data)
      ? payload.data
      : [payload.data]
  return rows.map((option) => normalizeListingOption(option))
}

function normalizeListingOption(option: ListingOption): ListingOption {
  const record = option as Record<string, unknown>
  const hasPairIds = Boolean(option.base_id && option.quote_id)
  const hasPairClasses = Boolean(option.base_asset_class && option.quote_asset_class)
  const shouldUseEquity = !hasPairIds && !hasPairClasses
  const equityId = option.equity_id ?? (shouldUseEquity ? option.id ?? null : null)
  const baseId = option.base_id ?? null
  const quoteId = option.quote_id ?? null
  const baseAssetClass = option.base_asset_class ?? null
  const quoteAssetClass = option.quote_asset_class ?? null
  const resolvedId =
    option.id ?? equityId ?? (baseId && quoteId ? `${baseId}:${quoteId}` : undefined)

  return {
    id: resolvedId ?? option.id,
    base: option.base,
    quote: option.quote ?? null,
    name: option.name ?? null,
    iconUrl: option.iconUrl ?? null,
    assetClass: option.assetClass ?? null,
    primaryMicCode: option.primaryMicCode ?? null,
    countryCode: option.countryCode ?? null,
    cityName: option.cityName ?? null,
    timeZoneName: option.timeZoneName ?? null,
    equity_id: equityId,
    base_id: baseId,
    quote_id: quoteId,
    base_asset_class: baseAssetClass,
    quote_asset_class: quoteAssetClass,
  }
}
