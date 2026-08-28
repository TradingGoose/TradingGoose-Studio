import { alphaVantageProviderConfig } from '@/providers/market/alpha-vantage/config'
import { fetchAlphaVantageSeries } from '@/providers/market/alpha-vantage/series'
import type { MarketProvider } from '@/providers/market/providers'
import type { MarketSeries, MarketSeriesRequest } from '@/providers/market/types'

export const alphaVantageProvider: MarketProvider = {
  id: 'alpha-vantage',
  name: 'Alpha Vantage',
  config: alphaVantageProviderConfig,
  fetchMarketSeries: async (request: MarketSeriesRequest): Promise<MarketSeries> => {
    return fetchAlphaVantageSeries(request)
  },
}
