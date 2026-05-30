import { useMemo } from 'react'
import { uniqueStrings } from '@/components/listing-selector/search-utils'
import { getMarketProviderConfig } from '@/providers/market/providers'
import { getTradingProviderConfig } from '@/providers/trading/providers'

export type ProviderSearchConfig = {
  assetClasses: string[]
  marketCodes: string[]
  listingQuoteCodes: string[]
  cryptoQuoteCodes: string[]
  currencyQuoteCodes: string[]
}

type ProviderSearchConfigSource = {
  availability?: {
    assetClass?: readonly string[]
    availableListingQuote?: readonly string[]
    availableCurrencyQuote?: readonly string[]
    availableCryptoQuote?: readonly string[]
  }
  exchangeCodeToMarket?: Record<string, string>
}

const EMPTY_PROVIDER_SEARCH_CONFIG: ProviderSearchConfig = {
  assetClasses: [],
  marketCodes: [],
  listingQuoteCodes: [],
  cryptoQuoteCodes: [],
  currencyQuoteCodes: [],
}

const toProviderSearchConfig = (
  providerConfig: ProviderSearchConfigSource | null | undefined
): ProviderSearchConfig => {
  const availability = providerConfig?.availability
  return {
    assetClasses: uniqueStrings(availability?.assetClass ?? []),
    marketCodes: uniqueStrings(Object.values(providerConfig?.exchangeCodeToMarket ?? {})),
    listingQuoteCodes: uniqueStrings(availability?.availableListingQuote ?? []),
    cryptoQuoteCodes: uniqueStrings(availability?.availableCryptoQuote ?? []),
    currencyQuoteCodes: uniqueStrings(availability?.availableCurrencyQuote ?? []),
  }
}

const combineValues = (left: string[], right: string[]): string[] => {
  if (!left.length) return right
  if (!right.length) return left
  const rightValues = new Set(right)
  return left.filter((value) => rightValues.has(value))
}

export const combineProviderSearchConfigs = (
  configs: ProviderSearchConfig[]
): ProviderSearchConfig =>
  configs.reduce(
    (combined, config) => ({
      assetClasses: combineValues(combined.assetClasses, config.assetClasses),
      marketCodes: combineValues(combined.marketCodes, config.marketCodes),
      listingQuoteCodes: combineValues(combined.listingQuoteCodes, config.listingQuoteCodes),
      cryptoQuoteCodes: combineValues(combined.cryptoQuoteCodes, config.cryptoQuoteCodes),
      currencyQuoteCodes: combineValues(combined.currencyQuoteCodes, config.currencyQuoteCodes),
    }),
    EMPTY_PROVIDER_SEARCH_CONFIG
  )

export function useMarketProviderSearchConfig(providerId?: string): ProviderSearchConfig {
  return useMemo(
    () => toProviderSearchConfig(providerId ? getMarketProviderConfig(providerId) : null),
    [providerId]
  )
}

export function useTradingProviderSearchConfig(providerId?: string): ProviderSearchConfig {
  return useMemo(
    () => toProviderSearchConfig(providerId ? getTradingProviderConfig(providerId) : null),
    [providerId]
  )
}
