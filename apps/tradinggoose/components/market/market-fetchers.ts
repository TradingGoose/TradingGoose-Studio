import type { CurrencyOption, ListingOption } from '@/stores/market/selector/store'

export async function fetchCurrencies(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<CurrencyOption[]> {
  const query = new URLSearchParams(params)
  const response = await fetch(`/api/market/search/currencies?${query.toString()}`, { signal })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    const message = payload?.error || `Request failed with ${response.status}`
    throw new Error(message)
  }
  const payload = (await response.json()) as { data?: CurrencyOption[] | CurrencyOption | null }
  if (!payload?.data) return []
  if (Array.isArray(payload.data)) return payload.data
  return [payload.data]
}

export async function fetchListings(
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<ListingOption[]> {
  const query = new URLSearchParams(params)
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
  const listingId =
    typeof record.listing_id === 'string' && record.listing_id.trim()
      ? record.listing_id
      : undefined
  const equityId = option.equity_id ?? listingId ?? null
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
