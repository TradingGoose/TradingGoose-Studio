import {
  parseCategorizedSearchQuery,
  serializeArrayParam,
  type ParsedMarketQuery,
} from '@/components/listing-selector/search-utils'
import type { ProviderSearchConfig } from '@/components/listing-selector/selector/use-provider-config'

export type MarketListingSearchRequest = {
  queryParams: Record<string, string>
  requestKey: string
}

export function buildMarketSearchRequest(args: {
  rawQuery: string
  providerId?: string
  providerConfig: ProviderSearchConfig
}): MarketListingSearchRequest {
  const { rawQuery, providerId, providerConfig } = args
  const trimmed = rawQuery.trim()

  const queryParams: Record<string, string> = {}
  const filtersPayload: Record<string, unknown> = {
    limit: 50,
  }
  const parsedQuery: ParsedMarketQuery = trimmed ? parseCategorizedSearchQuery(trimmed) : {}
  const resolvedAssetClasses = parsedQuery.assetClass
    ? [parsedQuery.assetClass]
    : providerConfig.assetClasses.length
      ? providerConfig.assetClasses
      : []

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

  const resolvedMicCodes = providerConfig.micCodes.length ? providerConfig.micCodes : []
  if (resolvedMicCodes.length && includeListings) {
    filtersPayload.mic = resolvedMicCodes
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
  if (Object.keys(filtersPayload).length > 0) {
    queryParams.filters = JSON.stringify(filtersPayload)
  }

  const requestKey = JSON.stringify({
    trimmed,
    rawQuery,
    providerId,
    assetClasses: resolvedAssetClasses,
    micCodes: resolvedMicCodes,
    listingQuoteCodes: providerConfig.listingQuoteCodes,
    cryptoQuoteCodes: providerConfig.cryptoQuoteCodes,
    currencyQuoteCodes: providerConfig.currencyQuoteCodes,
    parsedQuery,
    filters: filtersPayload,
  })

  return { queryParams, requestKey }
}
