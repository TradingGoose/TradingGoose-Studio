import { ibkrMarketProviderConfig } from '@/providers/market/ibkr/config'
import { fetchIbkrLiveSnapshot } from '@/providers/market/ibkr/live'
import { fetchIbkrSeries } from '@/providers/market/ibkr/series'
import type { MarketProvider } from '@/providers/market/providers'
import type {
  MarketLiveRequest,
  MarketLiveSnapshot,
  MarketSeries,
  MarketSeriesRequest,
} from '@/providers/market/types'

export const ibkrMarketProvider: MarketProvider = {
  id: 'ibkr',
  name: 'IBKR',
  config: ibkrMarketProviderConfig,
  fetchMarketSeries: async (request: MarketSeriesRequest): Promise<MarketSeries> => {
    return fetchIbkrSeries(request)
  },
  fetchMarketLive: async (request: MarketLiveRequest): Promise<MarketLiveSnapshot> => {
    return fetchIbkrLiveSnapshot(request)
  },
}
