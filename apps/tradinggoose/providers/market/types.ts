// Minimal OHLCV schema aligned with Lean TradeBar and OpenBB Historical models.
// Keep it small; adapters can add provider-specific metadata separately.

export const MARKET_DATA_TYPES = ['series', 'news', 'sentiments', 'live'] as const
export type MarketDataType = (typeof MARKET_DATA_TYPES)[number]

export type MarketDataAvailability = {
  currency: string[]
  assetClass: AssetClass[]
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
}

export interface MarketSeries {
  listingId: string
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
  start?: string
  end?: string
  timezone?: string // IANA tz, e.g. "America/New_York"
  normalizationMode?: string
  bars: MarketBar[]
}

export interface MarketRequestBase {
  listingId: string
  providerParams?: MarketProviderParams
  start?: string | number
  end?: string | number
}

export interface MarketSeriesRequest extends MarketRequestBase {
  kind: 'series'
  interval?: string
  normalizationMode?: string
}

export interface MarketNewsRequest extends MarketRequestBase {
  kind: 'news'
}

export interface MarketSentimentRequest extends MarketRequestBase {
  kind: 'sentiments'
}

export interface MarketLiveRequest extends MarketRequestBase {
  kind: 'live'
  interval?: string
  stream?: string
}

export type MarketProviderRequest =
  | MarketSeriesRequest
  | MarketNewsRequest
  | MarketSentimentRequest
  | MarketLiveRequest

export interface MarketProviderParams {
  apiKey?: string
  apiSecret?: string
  interval?: string
  [key: string]: any
}

export interface NewsItem {
  timeStamp: string // ISO timestamp of publication
  title: string
  url?: string
  source?: string
  symbols?: string[]
  sentimentLabel?: SentimentLabel
  sentimentScore?: number
}

export interface NewsSeries {
  items: NewsItem[]
}

export type SentimentLabel =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'bullish'
  | 'bearish'

export interface SentimentPoint {
  timeStamp: string
  symbols?: string[]
  sentimentLabel?: SentimentLabel
  sentimentScore?: number
  sentimentConfidence?: number
  source?: string
}

export interface SentimentSeries {
  items: SentimentPoint[]
}

export interface MarketLiveSnapshot {
  listingId: string
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
  interval?: string
  timezone?: string
  stream?: string
  bar: MarketBar
}
