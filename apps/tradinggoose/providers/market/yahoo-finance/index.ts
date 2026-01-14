import type { MarketProvider } from '@/providers/market/providers'
import type { MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { YahooFinanceProviderConfig } from '@/providers/market/yahoo-finance/config'
import { fetchYahooFinanceSeries } from '@/providers/market/yahoo-finance/series'

export const YahooFinanceProvider: MarketProvider = {
  id: 'yahoo-finance',
  name: 'YahooFinance',
  config: YahooFinanceProviderConfig,
  fetchMarketSeries: async (request: MarketSeriesRequest): Promise<MarketSeries> => {
    return fetchYahooFinanceSeries(request)
  },
}
