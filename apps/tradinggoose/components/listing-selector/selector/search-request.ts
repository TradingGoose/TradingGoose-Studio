import {
  type ParsedMarketQuery,
  parseCategorizedSearchQuery,
  serializeArrayParam,
} from '@/components/listing-selector/search-utils'
import type { ProviderSearchConfig } from '@/components/listing-selector/selector/use-provider-config'
import { MARKET_ASSET_CLASSES } from '@/providers/market/types'

export type MarketListingSearchRequest = {
  queryParams: Record<string, string>
  requestKey: string
}

export function buildMarketSearchRequest(args: {
  rawQuery: string
  providerConfig: ProviderSearchConfig
  assetClassFilter?: string | null
}): MarketListingSearchRequest {
  const { rawQuery, providerConfig, assetClassFilter } = args
  const trimmed = rawQuery.trim()

  const queryParams: Record<string, string> = {}
  const filtersPayload: Record<string, unknown> = {}
  const parsedQuery: ParsedMarketQuery = trimmed ? parseCategorizedSearchQuery(trimmed) : {}
  const requestedAssetClass = assetClassFilter?.trim().toLowerCase() || parsedQuery.assetClass
  if (
    requestedAssetClass &&
    providerConfig.assetClasses.length &&
    !providerConfig.assetClasses.includes(requestedAssetClass)
  ) {
    return {
      queryParams,
      requestKey: JSON.stringify(queryParams),
    }
  }

  const resolvedAssetClasses = requestedAssetClass
    ? [requestedAssetClass]
    : providerConfig.assetClasses.length
      ? providerConfig.assetClasses
      : [...MARKET_ASSET_CLASSES]

  if (resolvedAssetClasses.length) {
    filtersPayload.asset_class = resolvedAssetClasses
  }

  const normalizedAssetClasses = resolvedAssetClasses.map((value) => value.toLowerCase())
  const includeCrypto =
    normalizedAssetClasses.length === 0 || normalizedAssetClasses.includes('crypto')
  const includeCurrency =
    normalizedAssetClasses.length === 0 || normalizedAssetClasses.includes('currency')
  const includeListings =
    normalizedAssetClasses.length === 0 ||
    normalizedAssetClasses.some((value) => value !== 'crypto' && value !== 'currency')

  const resolvedMarketCodes = providerConfig.marketCodes.length ? providerConfig.marketCodes : []

  if (includeListings && resolvedMarketCodes.length) {
    filtersPayload.market = resolvedMarketCodes
  }

  if (includeListings && providerConfig.listingQuoteCodes.length) {
    queryParams.listing_quote_code = serializeArrayParam(providerConfig.listingQuoteCodes)
  }
  if (includeCrypto && providerConfig.cryptoQuoteCodes.length) {
    queryParams.crypto_quote_code = serializeArrayParam(providerConfig.cryptoQuoteCodes)
  }
  if (includeCurrency && providerConfig.currencyQuoteCodes.length) {
    queryParams.currency_quote_code = serializeArrayParam(providerConfig.currencyQuoteCodes)
  }

  if (trimmed) {
    queryParams.search_query = rawQuery
  }
  if (parsedQuery.region) {
    filtersPayload.region = [parsedQuery.region]
  }
  queryParams.filters = JSON.stringify({ limit: 50, ...filtersPayload })

  return { queryParams, requestKey: JSON.stringify(queryParams) }
}
