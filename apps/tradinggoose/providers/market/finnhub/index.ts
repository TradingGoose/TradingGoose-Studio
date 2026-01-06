import type { MarketProvider } from '@/providers/market/providers'
import type {
  MarketLiveRequest,
  MarketLiveSnapshot,
  MarketNewsRequest,
  MarketSeries,
  MarketSeriesRequest,
  NewsSeries,
} from '@/providers/market/types'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import { fetchFinnhubLiveSnapshot } from '@/providers/market/finnhub/live'
import { fetchFinnhubNews } from '@/providers/market/finnhub/news'
import { fetchFinnhubSeries } from '@/providers/market/finnhub/series'

export const finnhubProvider: MarketProvider = {
  id: 'finnhub',
  name: 'Finnhub',
  config: finnhubProviderConfig,
  fetchMarketSeries: async (request: MarketSeriesRequest): Promise<MarketSeries> => {
    return fetchFinnhubSeries(request)
  },
  fetchNews: async (request: MarketNewsRequest): Promise<NewsSeries> => {
    return fetchFinnhubNews(request)
  },
  fetchMarketLive: async (request: MarketLiveRequest): Promise<MarketLiveSnapshot> => {
    return fetchFinnhubLiveSnapshot(request)
  },
}
