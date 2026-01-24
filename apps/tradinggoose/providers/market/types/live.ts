import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketBar } from './sereis'
import type { MarketRequestBase } from './base'

export interface MarketLiveRequest extends MarketRequestBase {
  kind: 'live'
  interval?: string
  stream?: string
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
