import { createLogger } from '@/lib/logs/console/logger'
import { ibkrMarketProviderConfig } from '@/providers/market/ibkr/config'
import type {
  MarketLiveRequest,
  MarketLiveSnapshot,
  MarketSeriesRequest,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { fetchIbkrSeries } from '@/providers/market/ibkr/series'

const logger = createLogger('MarketProvider:IBKR:Live')

export async function fetchIbkrLiveSnapshot(
  request: MarketLiveRequest
): Promise<MarketLiveSnapshot> {
  const seriesRequest: MarketSeriesRequest = {
    kind: 'series',
    listing: request.listing,
    interval: request.interval,
    start: Date.now() - 24 * 60 * 60 * 1000,
    end: Date.now(),
    auth: request.auth,
    providerParams: request.providerParams,
  }

  logger.info('Fetching IBKR live snapshot', {
    listing: request.listing,
    interval: seriesRequest.interval,
  })

  const series = await fetchIbkrSeries(seriesRequest)
  const bar = series.bars[series.bars.length - 1]

  if (!bar) {
    throw new Error('No live bar data returned')
  }

  return {
    listing: series.listing,
    listingBase: series.listingBase,
    listingQuote: series.listingQuote,
    marketCode: series.marketCode,
    interval: seriesRequest.interval,
    timezone: series.timezone,
    stream: request.stream,
    bar,
  }
}
