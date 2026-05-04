import {
  type ListingIdentity,
  type ListingOption,
  type ListingType,
  toListingValueObject,
} from '@/lib/listing/identity'
import { MARKET_API_VERSION } from '@/lib/market/client/constants'
import { getBaseUrl } from '@/lib/urls/utils'
import type { AssetClass } from '@/providers/market/types'
import type { UnifiedTradingSymbol } from '@/providers/trading/types'

type MarketSearchResponse = {
  data?: ListingOption[] | ListingOption | null
  error?: string
}

type TradingListingResolutionInput = Pick<
  UnifiedTradingSymbol,
  'assetClass' | 'base' | 'listing' | 'quote'
>

const MARKET_ID_PREFIX_BY_TYPE: Record<ListingType, string> = {
  default: 'TG_LSTG_',
  crypto: 'TG_CRYP_',
  currency: 'TG_CURR_',
}

const buildMarketSearchUrl = (params: URLSearchParams) => {
  const relativeUrl = `/api/market/search?${params.toString()}`
  if (typeof window !== 'undefined') return relativeUrl
  return new URL(relativeUrl, getBaseUrl()).toString()
}

const normalizeCode = (value?: string | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed.toUpperCase() : null
}

const isMarketReferenceId = (value: string, listingType: ListingType) =>
  value.toUpperCase().startsWith(MARKET_ID_PREFIX_BY_TYPE[listingType])

const isCanonicalMarketIdentity = (listing: ListingIdentity) => {
  if (listing.listing_type === 'default') {
    return isMarketReferenceId(listing.listing_id, 'default')
  }

  if (!isMarketReferenceId(listing.base_id, listing.listing_type)) return false

  const quoteType = listing.quote_id.toUpperCase().startsWith(MARKET_ID_PREFIX_BY_TYPE.crypto)
    ? 'crypto'
    : 'currency'
  return isMarketReferenceId(listing.quote_id, quoteType)
}

const resolveListingType = (
  listing: ListingIdentity | null,
  assetClass?: AssetClass | null
): ListingType => {
  if (listing?.listing_type) return listing.listing_type
  if (assetClass === 'crypto') return 'crypto'
  if (assetClass === 'currency') return 'currency'
  return 'default'
}

const getSearchAssetClass = (listingType: ListingType, assetClass?: AssetClass | null) => {
  if (listingType !== 'default') return listingType
  if (assetClass && assetClass !== 'crypto' && assetClass !== 'currency') return assetClass
  return undefined
}

const getListingBaseCode = (
  input: TradingListingResolutionInput,
  listing: ListingIdentity | null,
  listingType: ListingType
) => {
  if (input.base) return normalizeCode(input.base)
  if (!listing) return null
  return normalizeCode(listingType === 'default' ? listing.listing_id : listing.base_id)
}

const getListingQuoteCode = (
  input: TradingListingResolutionInput,
  listing: ListingIdentity | null,
  listingType: ListingType
) => {
  if (input.quote) return normalizeCode(input.quote)
  if (!listing || listingType === 'default') return null
  return normalizeCode(listing.quote_id)
}

const readSearchRows = (payload: MarketSearchResponse): ListingOption[] => {
  if (!payload.data) return []
  return Array.isArray(payload.data) ? payload.data : [payload.data]
}

const matchesTradingSymbol = ({
  row,
  listingType,
  baseCode,
  quoteCode,
}: {
  row: ListingOption
  listingType: ListingType
  baseCode: string
  quoteCode?: string | null
}) => {
  if (row.listing_type !== listingType) return false
  if (normalizeCode(row.base) !== baseCode) return false
  if (quoteCode && normalizeCode(row.quote) !== quoteCode) return false
  return true
}

const fetchCanonicalListing = async ({
  listingType,
  assetClass,
  baseCode,
  quoteCode,
  signal,
}: {
  listingType: ListingType
  assetClass?: AssetClass | null
  baseCode: string
  quoteCode?: string | null
  signal?: AbortSignal
}) => {
  const params = new URLSearchParams({
    search_query: baseCode,
    version: MARKET_API_VERSION,
  })
  const filters: Record<string, unknown> = { limit: 10 }
  const searchAssetClass = getSearchAssetClass(listingType, assetClass)
  if (searchAssetClass) filters.asset_class = [searchAssetClass]

  params.set('filters', JSON.stringify(filters))
  if (quoteCode) {
    if (listingType === 'crypto') params.set('crypto_quote_code', quoteCode)
    if (listingType === 'currency') params.set('currency_quote_code', quoteCode)
    if (listingType === 'default') params.set('listing_quote_code', quoteCode)
  }

  const response = await fetch(buildMarketSearchUrl(params), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
  if (!response.ok) return null

  const payload = (await response.json().catch(() => ({}))) as MarketSearchResponse
  const row = readSearchRows(payload).find((candidate) =>
    matchesTradingSymbol({ row: candidate, listingType, baseCode, quoteCode })
  )
  return row ? toListingValueObject(row) : null
}

export async function resolveTradingPositionListingIdentity(
  input: TradingListingResolutionInput,
  signal?: AbortSignal
): Promise<ListingIdentity | null> {
  const listing = toListingValueObject(input.listing)
  if (listing && isCanonicalMarketIdentity(listing)) return listing

  const listingType = resolveListingType(listing, input.assetClass)
  const baseCode = getListingBaseCode(input, listing, listingType)
  if (!baseCode) return null

  const quoteCode = getListingQuoteCode(input, listing, listingType)
  if (listingType !== 'default' && !quoteCode) return null

  return fetchCanonicalListing({
    listingType,
    assetClass: input.assetClass,
    baseCode,
    quoteCode,
    signal,
  })
}
