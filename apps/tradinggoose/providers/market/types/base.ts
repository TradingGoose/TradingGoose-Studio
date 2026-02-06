import type { ListingIdentity } from '@/lib/listing/identity'

export const MARKET_DATA_TYPES = ['series', 'live'] as const
export type MarketDataType = (typeof MARKET_DATA_TYPES)[number]

export const MARKET_INTERVALS = [
  '1m',
  '2m',
  '3m',
  '5m',
  '10m',
  '15m',
  '30m',
  '45m',
  '1h',
  '2h',
  '3h',
  '4h',
  '1d',
  '1w',
  '2w',
  '1mo',
  '3mo',
  '6mo',
  '12mo',
] as const
export type MarketInterval = (typeof MARKET_INTERVALS)[number]

export type MarketRangeUnit = 'day' | 'week' | 'month' | 'year'

export type MarketDataAvailability = {
  assetClass: AssetClass[]
  availableListingQuote?: string[]
  availableCurrencyBase?: string[]
  availableCurrencyQuote?: string[]
  availableCryptoBase?: string[]
  availableCryptoQuote?: string[]
} & Record<MarketDataType, boolean>

export type AssetClass =
  | 'stock'
  | 'etf'
  | 'future'
  | 'currency'
  | 'crypto'
  | 'indice'
  | 'mutualfund'

export interface MarketProviderParams {
  interval?: string
  [key: string]: any
}

export type MarketProviderAuth = {
  apiKey?: string
  apiSecret?: string
}

export interface MarketRequestBase {
  listing: ListingIdentity
  auth?: MarketProviderAuth
  providerParams?: MarketProviderParams
  start?: string | number
  end?: string | number
}
