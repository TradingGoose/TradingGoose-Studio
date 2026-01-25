export * from './types/base'
export * from './types/sereis'
export * from './types/live'

import type { MarketLiveRequest } from './types/live'
import type { MarketSeriesRequest } from './types/sereis'

export type MarketProviderRequest = MarketSeriesRequest | MarketLiveRequest
