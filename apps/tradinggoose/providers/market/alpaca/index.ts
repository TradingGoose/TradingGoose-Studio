import type { MarketProvider } from '@/providers/market/providers'
import type {
  MarketLiveRequest,
  MarketLiveSnapshot,
  MarketSeries,
  MarketSeriesRequest,
} from '@/providers/market/types'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { fetchAlpacaLiveSnapshot } from '@/providers/market/alpaca/live'
import { fetchAlpacaSeries } from '@/providers/market/alpaca/series'

export const alpacaProvider: MarketProvider = {
  id: 'alpaca',
  name: 'Alpaca',
  config: alpacaProviderConfig,
  fetchMarketSeries: async (request: MarketSeriesRequest): Promise<MarketSeries> => {
    return fetchAlpacaSeries(request)
  },
  fetchMarketLive: async (request: MarketLiveRequest): Promise<MarketLiveSnapshot> => {
    return fetchAlpacaLiveSnapshot(request)
  },
}
