export * from './types/base'
export * from './types/live'
export * from './types/sereis'

import type { MarketLiveRequest } from './types/live'
import type { MarketSeriesRequest } from './types/sereis'

export type MarketProviderRequest = MarketSeriesRequest | MarketLiveRequest
