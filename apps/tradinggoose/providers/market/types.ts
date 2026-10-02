export * from './types/base'
export * from './types/live'
export * from './types/sereis'

import type { MarketRequestBase } from './types/base'
import type { MarketLiveRequest } from './types/live'
import type { MarketSeriesRequest } from './types/sereis'

export interface MarketQuoteRequest extends MarketRequestBase {
  kind: 'quote'
}

export type MarketProviderRequest = MarketSeriesRequest | MarketLiveRequest | MarketQuoteRequest
