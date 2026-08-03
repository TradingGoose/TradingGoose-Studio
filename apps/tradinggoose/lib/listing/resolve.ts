import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
  ListingResolvedSchema,
} from '@/lib/listing/identity'
import { MARKET_API_VERSION, MARKET_BATCH_ID_LIMIT } from '@/lib/market/client/constants'
import { getBaseUrl } from '@/lib/urls/utils'

type ResolvedListingDetails = Partial<Omit<ListingResolved, 'listingIdentity'>>

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
  failureMode: 'strict' | 'partial',
  signal?: AbortSignal
): Promise<Record<string, T | null>> => {
  const uniqueIds = uniqueNonEmpty(ids)
  const result: Record<string, T | null> = {}
  if (!uniqueIds.length) return result

  if (uniqueIds.length > MARKET_BATCH_ID_LIMIT) {
    const batches = Array.from(
      { length: Math.ceil(uniqueIds.length / MARKET_BATCH_ID_LIMIT) },
      (_, index) =>
        fetchMarketBatch<T>(
          path,
          paramName,
          uniqueIds.slice(index * MARKET_BATCH_ID_LIMIT, (index + 1) * MARKET_BATCH_ID_LIMIT),
          failureMode,
          signal
        )
    )
    return Object.assign(result, ...(await Promise.all(batches)))
  }

  const params = new URLSearchParams()
  uniqueIds.forEach((id) => params.append(paramName, id))
  const data = await fetchMarketSearch<any>(path, params, signal).catch((error) => {
    if (signal?.aborted) throw signal.reason
    if ((error as { name?: unknown })?.name === 'AbortError' || failureMode === 'strict')
      throw error
    return null
  })

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    uniqueIds.forEach((id) => {
      result[id] = null
    })
    return result
  }

  if (uniqueIds.length === 1) {
    result[uniqueIds[0]] = data as T
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
  const records = await fetchMarketBatch<T>(path, paramName, [id], 'strict', signal)
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
  const rowMaps = await fetchListingResolutionRowMaps([listing], 'strict', signal)
  try {
    return buildResolvedListingFromRows(listing, rowMaps)
  } catch {
    return null
  }
}

const fetchListingResolutionRowMaps = async (
  listings: readonly ListingIdentity[],
  failureMode: 'strict' | 'partial',
  signal?: AbortSignal
): Promise<ListingResolutionRowMaps> => {
  const listingIds: string[] = []
  const currencyIds: string[] = []
  const cryptoIds: string[] = []

  listings.forEach((listing) => {
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
    fetchMarketBatch<any>('listing', 'listing_id', listingIds, failureMode, signal),
    fetchMarketBatch<any>('currency', 'currency_id', currencyIds, failureMode, signal),
    fetchMarketBatch<any>('crypto', 'crypto_id', cryptoIds, failureMode, signal),
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
    const key = getListingIdentityKey(listing)
    if (!identities.has(key)) {
      identities.set(key, listing)
    }
  }

  const rowMaps = await fetchListingResolutionRowMaps(
    Array.from(identities.values()),
    'partial',
    signal
  )

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

  const parsed = ListingResolvedSchema.safeParse({
    ...details,
    listingIdentity: listing,
    base,
  })
  return parsed.success ? parsed.data : null
}
