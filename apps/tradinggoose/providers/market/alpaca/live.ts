import { createLogger } from '@/lib/logs/console/logger'
import type { MarketLiveRequest, MarketLiveSnapshot, MarketSeriesRequest } from '@/providers/market/types'
import { fetchAlpacaSeries } from '@/providers/market/alpaca/series'

const logger = createLogger('MarketProvider:Alpaca:Live')

export async function fetchAlpacaLiveSnapshot(
  request: MarketLiveRequest
): Promise<MarketLiveSnapshot> {
  const providerParams = {
    ...(request.providerParams || {}),
    limit: 1,
    sort: request.providerParams?.sort ?? 'desc',
  }

  const seriesRequest: MarketSeriesRequest = {
    kind: 'series',
    listing: request.listing,
    interval: request.interval,
    providerParams,
  }

  logger.info('Fetching Alpaca live snapshot', {
    listing: request.listing,
    interval: seriesRequest.interval,
    limit: providerParams.limit,
  })

  const series = await fetchAlpacaSeries(seriesRequest)
  const bar = series.bars[series.bars.length - 1]

  if (!bar) {
    throw new Error('No live bar data returned')
  }

  return {
    listing: series.listing,
    listingBase: series.listingBase,
    listingQuote: series.listingQuote,
    primaryMicCode: series.primaryMicCode,
    interval: seriesRequest.interval,
    timezone: series.timezone,
    stream: request.stream,
    bar,
  }
}
