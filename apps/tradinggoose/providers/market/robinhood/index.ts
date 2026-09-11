import { MarketProviderError } from '@/providers/market/errors'
import type { MarketProvider } from '@/providers/market/providers'
import { robinhoodProviderConfig } from '@/providers/market/robinhood/config'
import { fetchRobinhoodSeries } from '@/providers/market/robinhood/series'

export const robinhoodProvider: MarketProvider = {
  id: 'robinhood',
  name: 'Robinhood',
  config: robinhoodProviderConfig,
  fetchMarketSeries: fetchRobinhoodSeries,
  fetchMarketLive: async (request) => {
    const interval = request.interval ?? '1m'
    const series = await fetchRobinhoodSeries({
      ...request,
      kind: 'series',
      interval,
      windows: [{ mode: 'bars', barCount: 1 }],
    })
    const bar = series.bars.at(-1)
    if (!bar)
      throw new MarketProviderError({
        code: 'EMPTY SERIES',
        message: 'Robinhood returned no recent bars',
        provider: 'robinhood',
        status: 422,
      })
    const { bars: _bars, ...metadata } = series
    return { ...metadata, interval, bar }
  },
}
