import { useMemo } from 'react'
import { getMarketProviderConfig } from '@/providers/market/providers'
import { getTradingProviderConfig } from '@/providers/trading/providers'
import { uniqueStrings } from '@/components/listing-selector/search-utils'

export type ProviderSearchConfig = {
  assetClasses: string[]
  micCodes: string[]
  listingQuoteCodes: string[]
  cryptoQuoteCodes: string[]
  currencyQuoteCodes: string[]
}

export function useMarketProviderSearchConfig(providerId?: string): ProviderSearchConfig {
  const providerConfig = useMemo(
    () => (providerId ? getMarketProviderConfig(providerId) : null),
    [providerId]
  )

  const assetClasses = useMemo(() => {
    const values = providerConfig?.availability.assetClass ?? []
    return uniqueStrings(values)
  }, [providerConfig])

  const listingQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableListingQuote ?? [])
  }, [providerConfig])

  const currencyQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCurrencyQuote ?? [])
  }, [providerConfig])

  const cryptoQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCryptoQuote ?? [])
  }, [providerConfig])

  const micCodes = useMemo(() => {
    const map = providerConfig?.exchangeCodeToMic ?? {}
    const codes = Object.values(map).flat()
    return uniqueStrings(codes)
  }, [providerConfig])

  return useMemo(
    () => ({
      assetClasses,
      micCodes,
      listingQuoteCodes,
      cryptoQuoteCodes,
      currencyQuoteCodes,
    }),
    [assetClasses, micCodes, listingQuoteCodes, cryptoQuoteCodes, currencyQuoteCodes]
  )
}

export function useTradingProviderSearchConfig(providerId?: string): ProviderSearchConfig {
  const providerConfig = useMemo(
    () => (providerId ? getTradingProviderConfig(providerId) : null),
    [providerId]
  )

  const assetClasses = useMemo(() => {
    const values = providerConfig?.availability.assetClass ?? []
    return uniqueStrings(values)
  }, [providerConfig])

  const listingQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableListingQuote ?? [])
  }, [providerConfig])

  const currencyQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCurrencyQuote ?? [])
  }, [providerConfig])

  const cryptoQuoteCodes = useMemo(() => {
    const availability = providerConfig?.availability
    return uniqueStrings(availability?.availableCryptoQuote ?? [])
  }, [providerConfig])

  const micCodes = useMemo(() => {
    const map = providerConfig?.exchangeCodeToMic ?? {}
    const codes = Object.values(map).flat()
    return uniqueStrings(codes)
  }, [providerConfig])

  return useMemo(
    () => ({
      assetClasses,
      micCodes,
      listingQuoteCodes,
      cryptoQuoteCodes,
      currencyQuoteCodes,
    }),
    [assetClasses, micCodes, listingQuoteCodes, cryptoQuoteCodes, currencyQuoteCodes]
  )
}
