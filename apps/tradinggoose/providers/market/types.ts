// Minimal OHLCV schema aligned with Lean TradeBar and OpenBB Historical models.
// Keep it small; adapters can add provider-specific metadata separately.

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

export interface MarketSeriesWindow {
  mode: 'bars' | 'range'
  barCount?: number
  range?: { value: number; unit: MarketRangeUnit }
}

export type MarketDataAvailability = {
  assetClass: AssetClass[]
  availableEquityQuote?: string[]
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

export interface MarketBar {
  timeStamp: string // ISO timestamp (or date string)
  open?: number
  high?: number
  low?: number
  close: number
  volume?: number
  turnover?: number
}

export const NORMALIZATION_MODES = [
  'raw',
  'adjusted',
  'split_adjusted',
  'total_return',
  'forward_panama_canal',
  'backwards_panama_canal',
  'backwards_ratio',
  'scaled_raw',
] as const
export type NormalizationMode = (typeof NORMALIZATION_MODES)[number]


export interface MarketSeries {
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
  listing?: ListingIdentity | null
  start?: string
  end?: string
  timezone?: string // IANA tz, e.g. "America/New_York"
  normalizationMode?: NormalizationMode
  bars: MarketBar[]
}

export interface MarketRequestBase {
  listing: ListingIdentity
  providerParams?: MarketProviderParams
  start?: string | number
  end?: string | number
}

export interface MarketSeriesRequest extends MarketRequestBase {
  kind: 'series'
  interval?: string
  normalizationMode?: NormalizationMode
  window?: MarketSeriesWindow
}

export interface MarketLiveRequest extends MarketRequestBase {
  kind: 'live'
  interval?: string
  stream?: string
}

export type MarketProviderRequest =
  | MarketSeriesRequest
  | MarketLiveRequest

export interface MarketProviderParams {
  apiKey?: string
  apiSecret?: string
  interval?: string
  [key: string]: any
}

export interface MarketLiveSnapshot {
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
  listing?: ListingIdentity | null
  interval?: string
  timezone?: string
  stream?: string
  bar: MarketBar
}
