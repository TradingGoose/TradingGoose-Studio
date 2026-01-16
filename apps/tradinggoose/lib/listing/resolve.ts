import { env } from '@/lib/env'
import { MARKET_API_URL_DEFAULT, MARKET_API_VERSION } from '@/lib/market/client/constants'
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
  countryCode?: string | null
  cityName?: string | null
  timeZoneName?: string | null
}

type MarketSearchResponse<T> = {
  data?: T
  error?: string
}

const toArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

const fetchMarketSearch = async <T>(
  path: string,
  params: URLSearchParams
): Promise<T | null> => {
  if (!params.get('version')) {
    params.set('version', MARKET_API_VERSION)
  }
  const baseUrl = env.MARKET_API_URL || MARKET_API_URL_DEFAULT
  const endpoint = new URL(`/api/search/${path}`, baseUrl)
  endpoint.search = params.toString()
  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(env.MARKET_API_KEY ? { 'x-api-key': env.MARKET_API_KEY } : {}),
    },
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
  if (!payload) return null
  if (payload.error) {
    throw new Error(payload.error)
  }
  return payload.data ?? null
}

const resolveEquityById = async (
  equityId: string
): Promise<ResolvedListingDetails | null> => {
  const params = new URLSearchParams({
    equity_id: equityId,
    limit: '1',
  })
  const data = await fetchMarketSearch<any>('equity', params)
  const listing = toArray(data)[0]
  if (!listing || typeof listing !== 'object') return null
  return {
    base: listing.base,
    quote: listing.quote ?? null,
    name: listing.name ?? null,
    iconUrl: listing.iconUrl ?? null,
    assetClass: listing.assetClass ?? null,
    primaryMicCode: listing.primaryMicCode ?? null,
    countryCode: listing.countryCode ?? null,
    cityName: listing.cityName ?? null,
    timeZoneName: listing.timeZoneName ?? null,
  }
}

const resolveCurrencyById = async (
  currencyId: string
): Promise<{ code?: string; name?: string | null; iconUrl?: string | null } | null> => {
  const params = new URLSearchParams({
    currency_id: currencyId,
    limit: '1',
  })
  const data = await fetchMarketSearch<any>('currencies', params)
  const row = toArray(data)[0]
  if (!row || typeof row !== 'object') return null
  return { code: row.code, name: row.name ?? null, iconUrl: row.iconUrl ?? null }
}

const resolveCurrencyPair = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const [base, quote] = await Promise.all([
    resolveCurrencyById(baseId),
    resolveCurrencyById(quoteId),
  ])
  if (!base?.code || !quote?.code) return null
  const baseName = base.name?.trim() || base.code
  const quoteName = quote.name?.trim() || quote.code
  return {
    base: base.code,
    quote: quote.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: base.iconUrl ?? null,
    assetClass: 'currency',
    base_asset_class: 'currency',
    quote_asset_class: 'currency',
  }
}

const resolveCryptoPair = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const params = new URLSearchParams({
    crypto_base_id: baseId,
    crypto_quote_id: quoteId,
    limit: '5',
  })
  const data = await fetchMarketSearch<any>('cryptos', params)
  const pairs = toArray(data)
  if (!pairs.length) return null
  const selected =
    pairs.find((pair) => pair?.crypto_quote?.id === quoteId) ?? pairs[0]
  if (!selected?.crypto_base?.code) return null
  const quote = selected.crypto_quote?.code ?? null
  const quoteType = selected.crypto_quote?.type
  const baseName = selected.crypto_base?.name?.trim() || selected.crypto_base?.code
  const quoteName = selected.crypto_quote?.name?.trim() || selected.crypto_quote?.code
  return {
    base: selected.crypto_base.code,
    quote,
    name: baseName && quoteName ? `${baseName} to ${quoteName} pair` : null,
    iconUrl: selected.crypto_base?.iconUrl ?? null,
    assetClass: 'crypto',
    base_asset_class: 'crypto',
    quote_asset_class: quoteType === 'crypto' ? 'crypto' : 'currency',
  }
}

const resolveCryptoBase = async (
  baseId: string
): Promise<{ code?: string; name?: string | null; iconUrl?: string | null } | null> => {
  const params = new URLSearchParams({
    crypto_base_id: baseId,
    limit: '1',
  })
  const data = await fetchMarketSearch<any>('cryptos', params)
  const pair = toArray(data)[0]
  const base = pair?.crypto_base
  if (!base?.code) return null
  return { code: base.code, name: base.name ?? null, iconUrl: base.iconUrl ?? null }
}

const resolveCryptoWithCurrencyQuote = async (
  baseId: string,
  quoteId: string
): Promise<ResolvedListingDetails | null> => {
  const [base, quote] = await Promise.all([
    resolveCryptoBase(baseId),
    resolveCurrencyById(quoteId),
  ])
  if (!base?.code || !quote?.code) return null
  const baseName = base.name?.trim() || base.code
  const quoteName = quote.name?.trim() || quote.code
  return {
    base: base.code,
    quote: quote.code,
    name: `${baseName} to ${quoteName} pair`,
    iconUrl: base.iconUrl ?? null,
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
  const equityId = listing.equity_id?.trim()
  const baseId = listing.base_id?.trim()
  const quoteId = listing.quote_id?.trim()

  if (listingType === 'equity') {
    if (!equityId) return null
    const details = await resolveEquityById(equityId)
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
    listing.listing_type === 'equity'
      ? {
          equity_id: listing.equity_id?.trim() ?? '',
          base_id: '',
          quote_id: '',
          listing_type: listing.listing_type,
        }
      : {
          equity_id: '',
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
    countryCode: details.countryCode ?? null,
    cityName: details.cityName ?? null,
    timeZoneName: details.timeZoneName ?? null,
  }
}
