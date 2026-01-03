// Minimal OHLCV schema aligned with Lean TradeBar and OpenBB Historical models.
// Keep it small; adapters can add provider-specific metadata separately.

export const MARKET_DATA_TYPES = ['series', 'news', 'sentiments'] as const
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
  listingId: string
  start?: string
  end?: string
  timezone?: string // IANA tz, e.g. "America/New_York"
  normalizationMode?: NormalizationMode
  bars: MarketBar[]
}

export interface MarketRequestBase {
  listingId: string
  providerParams?: MarketProviderParams
  start: string | number
  end: string | number
}

export interface MarketSeriesRequest extends MarketRequestBase {
  kind: 'series'
  interval?: string
  normalizationMode?: NormalizationMode
}

export interface MarketNewsRequest extends MarketRequestBase {
  kind: 'news'
}

export interface MarketSentimentRequest extends MarketRequestBase {
  kind: 'sentiments'
}

export type MarketProviderRequest =
  | MarketSeriesRequest
  | MarketNewsRequest
  | MarketSentimentRequest

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
