import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
  toListingValueObject,
} from '@/lib/listing/identity'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { getBaseUrl } from '@/lib/urls/utils'

export type ResolvedListingDetails = {
  base?: string
  quote?: string | null
  name?: string | null
  iconUrl?: string | null
  assetClass?: string | null
  base_asset_class?: string | null
  quote_asset_class?: string | null
  primaryMicCode?: string | null
  marketCode?: string | null
  countryCode?: string | null
  cityName?: string | null
  timeZoneName?: string | null
}

type MarketSearchResponse<T> = {
  data?: T
  error?: string
}

type CodeRow = { code?: string; name?: string | null; iconUrl?: string | null }

export type ListingResolutionRowMaps = {
  listings: Record<string, unknown | null>
  currencies: Record<string, unknown | null>
  cryptos: Record<string, unknown | null>
}

const buildMarketGetUrl = (path: string, params: URLSearchParams) => {
  const relativeUrl = `/api/market/get/${path}?${params.toString()}`
  if (typeof window !== 'undefined') {
    return relativeUrl
  }

  return new URL(relativeUrl, getBaseUrl()).toString()
}

export const uniqueNonEmpty = (values: string[]) => {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    result.push(trimmed)
  }
  return result
}

export const toCodeRow = (row: unknown): CodeRow | null => {
  if (!row || typeof row !== 'object') return null
  const record = row as CodeRow
  return { code: record.code, name: record.name ?? null, iconUrl: record.iconUrl ?? null }
}

export const fetchMarketSearch = async <T>(
  path: string,
  params: URLSearchParams,
  signal?: AbortSignal
): Promise<T | null> => {
  if (!params.get('version')) {
    params.set('version', MARKET_API_VERSION)
  }

  const response = await fetch(buildMarketGetUrl(path, params), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
  })

  let payload: MarketSearchResponse<T> | null = null
  try {
    payload = (await response.json()) as MarketSearchResponse<T>
  } catch {
    payload = null
  }

  if (!response.ok) {
    throw new Error(payload?.error || `Market search failed: ${path}`)
  }

  if (!payload || typeof payload !== 'object') return null
  if (payload.error) {
    throw new Error(payload.error)
  }
  return payload.data ?? null
}

export const fetchMarketBatch = async <T>(
  path: string,
  paramName: string,
  ids: string[],
  signal?: AbortSignal
): Promise<Record<string, T | null>> => {
  const uniqueIds = uniqueNonEmpty(ids)
  const result: Record<string, T | null> = {}
  if (!uniqueIds.length) return result

  const params = new URLSearchParams()
  uniqueIds.forEach((id) => params.append(paramName, id))
  const data = await fetchMarketSearch<any>(path, params, signal)

  if (!data) {
    uniqueIds.forEach((id) => {
      result[id] = null
    })
    return result
  }

  if (uniqueIds.length === 1) {
    const single = data && typeof data === 'object' ? (data as T) : null
    result[uniqueIds[0]] = single
    return result
  }

  if (typeof data !== 'object' || Array.isArray(data)) {
    uniqueIds.forEach((id) => {
      result[id] = null
    })
    return result
  }

  const record = data as Record<string, unknown>
  uniqueIds.forEach((id) => {
    const value = record[id]
    result[id] = value && typeof value === 'object' ? (value as T) : null
  })
  return result
}

export const getBatchRow = async <T>(
  path: string,
  paramName: string,
  id: string,
  signal?: AbortSignal
): Promise<T | null> => {
  const records = await fetchMarketBatch<T>(path, paramName, [id], signal)
  return records[id] ?? null
}

const buildListingDetailsFromListingRow = (row: unknown): ResolvedListingDetails | null => {
  if (!row || typeof row !== 'object') return null
  const listing = row as ResolvedListingDetails
  return {
    base: listing.base,
    quote: listing.quote ?? null,
    name: listing.name ?? null,
    iconUrl: listing.iconUrl ?? null,
    assetClass: listing.assetClass ?? null,
    primaryMicCode: listing.primaryMicCode ?? null,
    marketCode: listing.marketCode ?? null,
    countryCode: listing.countryCode ?? null,
    cityName: listing.cityName ?? null,
    timeZoneName: listing.timeZoneName ?? null,
  }
}

const buildPairDetails = ({
  baseRow,
  quoteRow,
  assetClass,
  quoteAssetClass,
}: {
  baseRow: CodeRow | null
  quoteRow: CodeRow | null
  assetClass: 'currency' | 'crypto'
  quoteAssetClass: 'currency' | 'crypto'
}): ResolvedListingDetails | null => {
  if (!baseRow?.code || !quoteRow?.code) return null
  const baseName = baseRow.name?.trim() || baseRow.code
  const quoteName = quoteRow.name?.trim() || quoteRow.code
  return {
    base: baseRow.code,
    quote: quoteRow.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: baseRow.iconUrl ?? null,
    assetClass,
    base_asset_class: assetClass,
    quote_asset_class: quoteAssetClass,
  }
}

export const buildListingDetailsFromRows = (
  listing: ListingIdentity,
  rows: ListingResolutionRowMaps
): ResolvedListingDetails | null => {
  const listingType = listing.listing_type
  const listingId = listing.listing_id.trim()
  const baseId = listing.base_id.trim()
  const quoteId = listing.quote_id.trim()

  if (listingType === 'default') {
    if (!listingId) return null
    return buildListingDetailsFromListingRow(rows.listings[listingId])
  }

  if (!baseId || !quoteId) return null

  if (listingType === 'currency') {
    return buildPairDetails({
      baseRow: toCodeRow(rows.currencies[baseId]),
      quoteRow: toCodeRow(rows.currencies[quoteId]),
      assetClass: 'currency',
      quoteAssetClass: 'currency',
    })
  }

  if (listingType === 'crypto') {
    const isCryptoQuote = quoteId.toUpperCase().includes('CRYP')
    return buildPairDetails({
      baseRow: toCodeRow(rows.cryptos[baseId]),
      quoteRow: toCodeRow(isCryptoQuote ? rows.cryptos[quoteId] : rows.currencies[quoteId]),
      assetClass: 'crypto',
      quoteAssetClass: isCryptoQuote ? 'crypto' : 'currency',
    })
  }

  return null
}

export const buildResolvedListingFromRows = (
  listing: ListingIdentity,
  rows: ListingResolutionRowMaps
): ListingResolved | null => {
  const details = buildListingDetailsFromRows(listing, rows)
  return details ? buildResolvedListing(listing, details) : null
}

export async function resolveListingIdentity(
  listing: ListingIdentity,
  signal?: AbortSignal
): Promise<ListingResolved | null> {
  const normalized = toListingValueObject(listing)
  if (!normalized) return null
  const rowMaps = await fetchListingResolutionRowMaps([normalized], signal)
  try {
    return buildResolvedListingFromRows(normalized, rowMaps)
  } catch {
    return null
  }
}

const fetchListingResolutionRowMaps = async (
  listings: readonly ListingIdentity[],
  signal?: AbortSignal
): Promise<ListingResolutionRowMaps> => {
  const identities = new Map<string, ListingIdentity>()

  for (const listing of listings) {
    const normalized = toListingValueObject(listing)
    if (!normalized) continue
    const key = getListingIdentityKey(normalized)
    if (!identities.has(key)) {
      identities.set(key, normalized)
    }
  }

  const listingIds: string[] = []
  const currencyIds: string[] = []
  const cryptoIds: string[] = []

  identities.forEach((listing) => {
    if (listing.listing_type === 'default') {
      listingIds.push(listing.listing_id)
      return
    }

    if (listing.listing_type === 'currency') {
      currencyIds.push(listing.base_id, listing.quote_id)
      return
    }

    cryptoIds.push(listing.base_id)
    if (listing.quote_id.toUpperCase().includes('CRYP')) {
      cryptoIds.push(listing.quote_id)
    } else {
      currencyIds.push(listing.quote_id)
    }
  })

  const [listingRows, currencyRows, cryptoRows] = await Promise.all([
    fetchMarketBatch<any>('listing', 'listing_id', listingIds, signal),
    fetchMarketBatch<any>('currency', 'currency_id', currencyIds, signal),
    fetchMarketBatch<any>('crypto', 'crypto_id', cryptoIds, signal),
  ])

  return {
    listings: listingRows,
    currencies: currencyRows,
    cryptos: cryptoRows,
  }
}

export async function resolveListingIdentities(
  listings: readonly ListingIdentity[],
  signal?: AbortSignal
): Promise<Record<string, ListingResolved | null>> {
  const identities = new Map<string, ListingIdentity>()

  for (const listing of listings) {
    const normalized = toListingValueObject(listing)
    if (!normalized) continue
    const key = getListingIdentityKey(normalized)
    if (!identities.has(key)) {
      identities.set(key, normalized)
    }
  }

  const rowMaps = await fetchListingResolutionRowMaps(Array.from(identities.values()), signal)

  const resolved: Record<string, ListingResolved | null> = {}
  identities.forEach((listing, key) => {
    try {
      resolved[key] = buildResolvedListingFromRows(listing, rowMaps)
    } catch {
      resolved[key] = null
    }
  })

  return resolved
}

function buildResolvedListing(
  listing: ListingIdentity,
  details: ResolvedListingDetails
): ListingResolved | null {
  const base = details.base?.trim()
  if (!base) return null

  const normalizedIdentity: ListingIdentity =
    listing.listing_type === 'default'
      ? {
          listing_id: listing.listing_id?.trim() ?? '',
          base_id: '',
          quote_id: '',
          listing_type: listing.listing_type,
        }
      : {
          listing_id: '',
          base_id: listing.base_id?.trim() ?? '',
          quote_id: listing.quote_id?.trim() ?? '',
          listing_type: listing.listing_type,
        }

  return {
    ...normalizedIdentity,
    base,
    quote: details.quote ?? null,
    name: details.name ?? null,
    iconUrl: details.iconUrl ?? null,
    assetClass: details.assetClass ?? null,
    base_asset_class: details.base_asset_class ?? null,
    quote_asset_class: details.quote_asset_class ?? null,
    primaryMicCode: details.primaryMicCode ?? null,
    marketCode: details.marketCode ?? null,
    countryCode: details.countryCode ?? null,
    cityName: details.cityName ?? null,
    timeZoneName: details.timeZoneName ?? null,
  }
}
