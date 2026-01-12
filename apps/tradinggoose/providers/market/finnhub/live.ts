import { createLogger } from '@/lib/logs/console/logger'
import type { MarketLiveRequest, MarketLiveSnapshot, MarketSeriesRequest } from '@/providers/market/types'
import { fetchFinnhubSeries } from '@/providers/market/finnhub/series'

const logger = createLogger('MarketProvider:Finnhub:Live')

const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000
const MIN_LOOKBACK_MS = 5 * 60 * 1000

function parseIntervalToMs(interval?: string): number | null {
  if (!interval) return null
  const normalized = interval.trim().toLowerCase()
  if (/^\d+$/.test(normalized)) {
    const value = Number(normalized)
    return Number.isFinite(value) && value > 0 ? value * 60 * 1000 : null
  }
  const match = normalized.match(/^(\d+)?\s*(min|m|hour|h|day|d|week|w|month)/)
  if (!match) return null

  const value = Number(match[1] || '1')
  if (!Number.isFinite(value) || value <= 0) return null

  const unit = match[2]
  switch (unit) {
    case 'min':
    case 'm':
      return value * 60 * 1000
    case 'hour':
    case 'h':
      return value * 60 * 60 * 1000
    case 'day':
    case 'd':
      return value * 24 * 60 * 60 * 1000
    case 'week':
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000
    case 'month':
      return value * 30 * 24 * 60 * 60 * 1000
    default:
      return null
  }
}

function resolveLookbackMs(interval?: string): number {
  const duration = parseIntervalToMs(interval)
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

  const seriesRequest: MarketSeriesRequest = {
    kind: 'series',
    listing: request.listing,
    interval: request.interval,
    start,
    end,
    providerParams: request.providerParams,
  }

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
    listing: request.listing,
    listingBase: series.listingBase,
    listingQuote: series.listingQuote,
    primaryMicCode: series.primaryMicCode,
    interval: seriesRequest.interval,
    timezone: series.timezone,
    stream: request.stream,
    bar,
  }
}
