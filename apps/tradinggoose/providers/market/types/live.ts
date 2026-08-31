import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketRequestBase } from './base'
import type { MarketBar } from './sereis'

export interface MarketLiveRequest extends MarketRequestBase {
  kind: 'live'
  interval?: string
  stream?: string
}

export interface MarketLiveSnapshot {
  listingBase?: string
  listingQuote?: string
  marketCode?: string
  listing?: ListingIdentity | null
  interval?: string
  timezone?: string
  stream?: string
  bar: MarketBar
}
