import { createLogger } from '@/lib/logs/console/logger'
import { fetchFinnhubSeries } from '@/providers/market/finnhub/series'
import { intervalToMs, planMarketSeriesRequest } from '@/providers/market/series-planner'
import type { MarketLiveRequest, MarketLiveSnapshot } from '@/providers/market/types'

const logger = createLogger('MarketProvider:Finnhub:Live')

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000
const MIN_LOOKBACK_MS = 5 * 60 * 1000

function resolveLookbackMs(interval?: string): number {
  const duration = intervalToMs(interval)
  if (!duration) return DEFAULT_LOOKBACK_MS
  return Math.max(duration * 2, MIN_LOOKBACK_MS)
}

function resolveTimeRange(request: MarketLiveRequest): { start: number; end: number } {
  const now = Date.now()
  const interval = request.interval || (request.providerParams?.interval as string | undefined)
  const lookbackMs = resolveLookbackMs(interval)

  const end =
    typeof request.end === 'number'
      ? request.end
      : typeof request.end === 'string'
        ? Date.parse(request.end)
        : now

  const endMs = Number.isFinite(end) ? Number(end) : now

  const start =
    typeof request.start === 'number'
      ? request.start
      : typeof request.start === 'string'
        ? Date.parse(request.start)
        : endMs - lookbackMs

  const startMs = Number.isFinite(start) ? Number(start) : endMs - lookbackMs

  if (startMs >= endMs) {
    return { start: endMs - lookbackMs, end: endMs }
  }

  return { start: startMs, end: endMs }
}

export async function fetchFinnhubLiveSnapshot(
  request: MarketLiveRequest
): Promise<MarketLiveSnapshot> {
  const { start, end } = resolveTimeRange(request)

  const { request: seriesRequest } = planMarketSeriesRequest('finnhub', {
    kind: 'series',
    listing: request.listing,
    interval: request.interval,
    start,
    end,
    auth: request.auth,
    providerParams: request.providerParams,
  })

  logger.info('Fetching Finnhub live snapshot', {
    listing: request.listing,
    interval: seriesRequest.interval,
    start,
    end,
  })

  const series = await fetchFinnhubSeries(seriesRequest)
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
