// Minimal OHLCV schema aligned with Lean TradeBar and OpenBB Historical models.
// Keep it small; adapters can add provider-specific metadata separately.

import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, MarketRangeUnit, MarketRequestBase } from './base'

export type MarketSeriesWindowMode = 'bars' | 'range' | 'absolute'

export type MarketSeriesRange = { value: number; unit: MarketRangeUnit }

export type MarketSeriesWindow =
  | { mode: 'bars'; barCount: number }
  | { mode: 'range'; range: MarketSeriesRange }
  | { mode: 'absolute'; start: string | number; end?: string | number }

export interface MarketBar {
  timeStamp: string // ISO timestamp
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

export type MarketSessionType = 'premarket' | 'market' | 'postmarket'
export type MarketSessionMode = 'regular' | 'extended'

export interface MarketSessionWindow {
  date: string // YYYY-MM-DD (market local date)
  type: MarketSessionType
  start: string // ISO timestamp (UTC)
  end: string // ISO timestamp (UTC)
  timezone?: string
  utcOffset?: string
}

export interface MarketSeries {
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
  listing?: ListingIdentity | null
  start?: string
  end?: string
  timezone?: string // IANA tz, e.g. "America/New_York"
  normalizationMode?: NormalizationMode
  marketSessions?: MarketSessionWindow[]
  bars: MarketBar[]
}

export interface MarketSeriesRequest extends MarketRequestBase {
  kind: 'series'
  interval?: string
  normalizationMode?: NormalizationMode
  windows?: MarketSeriesWindow[]
}
