import { marketClient } from '@/lib/market/client'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { resolveListingKey, type ListingIdentity, type ListingResolved } from '@/lib/listing/identity'

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

const uniqueNonEmpty = (values: string[]) => {
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

const toCodeRow = (row: unknown): CodeRow | null => {
  if (!row || typeof row !== 'object') return null
  const record = row as CodeRow
  return { code: record.code, name: record.name ?? null, iconUrl: record.iconUrl ?? null }
}

const fetchMarketSearch = async <T>(
  path: string,
  params: URLSearchParams
): Promise<T | null> => {
  if (!params.get('version')) {
    params.set('version', MARKET_API_VERSION)
  }
  const response = await marketClient.makeRequest<MarketSearchResponse<T>>(
    `/api/get/${path}?${params.toString()}`
  )
  if (!response.success) {
    throw new Error(response.error || `Market search failed: ${path}`)
  }

  const payload = response.data as MarketSearchResponse<T> | null
  if (!payload || typeof payload !== 'object') return null
  if (payload.error) {
    throw new Error(payload.error)
  }
  return payload.data ?? null
}

const fetchMarketBatch = async <T>(
  path: string,
  paramName: string,
  ids: string[]
): Promise<Record<string, T | null>> => {
  const uniqueIds = uniqueNonEmpty(ids)
  const result: Record<string, T | null> = {}
  if (!uniqueIds.length) return result

  const params = new URLSearchParams()
  uniqueIds.forEach((id) => params.append(paramName, id))
  const data = await fetchMarketSearch<any>(path, params)

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
    result[id] = value && typeof value === 'object' ? (value as T) : (value ?? null)
  })
  return result
}

const getBatchRow = async <T>(path: string, paramName: string, id: string): Promise<T | null> => {
  const records = await fetchMarketBatch<T>(path, paramName, [id])
  return records[id] ?? null
}

const resolveListingById = async (
  listingId: string
): Promise<ResolvedListingDetails | null> => {
  const listing = await getBatchRow<any>('listing', 'listing_id', listingId)
  if (!listing || typeof listing !== 'object') return null
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

const resolveCurrencyById = async (
  currencyId: string
): Promise<{ code?: string; name?: string | null; iconUrl?: string | null } | null> => {
  return toCodeRow(await getBatchRow<any>('currency', 'currency_id', currencyId))
}

const resolveCryptoById = async (
  cryptoId: string
): Promise<{ code?: string; name?: string | null; iconUrl?: string | null } | null> => {
  return toCodeRow(await getBatchRow<any>('crypto', 'crypto_id', cryptoId))
}

const resolveCurrencyPair = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const records = await fetchMarketBatch<any>('currency', 'currency_id', [baseId, quoteId])
  const baseRow = toCodeRow(records[baseId])
  const quoteRow = toCodeRow(records[quoteId])
  if (!baseRow?.code || !quoteRow?.code) return null
  const baseName = baseRow.name?.trim() || baseRow.code
  const quoteName = quoteRow.name?.trim() || quoteRow.code
  return {
    base: baseRow.code,
    quote: quoteRow.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: baseRow.iconUrl ?? null,
    assetClass: 'currency',
    base_asset_class: 'currency',
    quote_asset_class: 'currency',
  }
}

const resolveCryptoPair = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const records = await fetchMarketBatch<any>('crypto', 'crypto_id', [baseId, quoteId])
  const baseRow = toCodeRow(records[baseId])
  const quoteRow = toCodeRow(records[quoteId])
  if (!baseRow?.code || !quoteRow?.code) return null
  const baseName = baseRow.name?.trim() || baseRow.code
  const quoteName = quoteRow.name?.trim() || quoteRow.code
  return {
    base: baseRow.code,
    quote: quoteRow.code,
    name: baseName && quoteName ? `${baseName} to ${quoteName} pair` : null,
    iconUrl: baseRow.iconUrl ?? null,
    assetClass: 'crypto',
    base_asset_class: 'crypto',
    quote_asset_class: 'crypto',
  }
}

const resolveCryptoWithCurrencyQuote = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const [cryptoRecords, currencyRecords] = await Promise.all([
    fetchMarketBatch<any>('crypto', 'crypto_id', [baseId]),
    fetchMarketBatch<any>('currency', 'currency_id', [quoteId]),
  ])
  const baseRow = toCodeRow(cryptoRecords[baseId])
  const quoteRow = toCodeRow(currencyRecords[quoteId])
  if (!baseRow?.code || !quoteRow?.code) return null
  const baseName = baseRow.name?.trim() || baseRow.code
  const quoteName = quoteRow.name?.trim() || quoteRow.code
  return {
    base: baseRow.code,
    quote: quoteRow.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: baseRow.iconUrl ?? null,
    assetClass: 'crypto',
    base_asset_class: 'crypto',
    quote_asset_class: 'currency',
  }
}

export async function resolveListingIdentity(
  listing: ListingIdentity
): Promise<ListingResolved | null> {
  if (!listing) return null

  const listingType = listing.listing_type
  const listingId = listing.listing_id?.trim()
  const baseId = listing.base_id?.trim()
  const quoteId = listing.quote_id?.trim()

  if (listingType === 'default') {
    if (!listingId) return null
    const details = await resolveListingById(listingId)
    return details ? buildResolvedListing(listing, details) : null
  }

  if (!baseId || !quoteId) return null

  if (listingType === 'currency') {
    const details = await resolveCurrencyPair(baseId, quoteId)
    return details ? buildResolvedListing(listing, details) : null
  }

  if (listingType === 'crypto') {
    const isCryptoQuote = quoteId.toUpperCase().includes('CRYP')
    const details = isCryptoQuote
      ? await resolveCryptoPair(baseId, quoteId)
      : await resolveCryptoWithCurrencyQuote(baseId, quoteId)
    return details ? buildResolvedListing(listing, details) : null
  }

  return null
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

  const listingKey = resolveListingKey(normalizedIdentity)
  if (!listingKey) return null

  return {
    id: listingKey,
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
