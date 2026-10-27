import { createLogger } from '@/lib/logs/console/logger'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import { toDate, toZonedIsoTimestamp } from '@/providers/market/market-hours/date-utils'
import { fetchMarketProviderJson } from '@/providers/market/request'
import { rangeToMs } from '@/providers/market/series-window'
import type {
  MarketBar,
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

const logger = createLogger('MarketProvider:Finnhub')

const FINNHUB_RESOLUTION_MAP: Partial<Record<MarketInterval, string>> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '1d': 'D',
  '1w': 'W',
  '1mo': 'M',
}

type FinnhubEndpoint = 'stock' | 'forex' | 'crypto'

function resolveTimeRange(request: MarketSeriesRequest): { from?: number; to?: number } {
  const window = request.windows?.[0]
  const rangeMs = window?.mode === 'range' ? rangeToMs(window.range) : null
  const start = toDate(request.start)
  const end = toDate(request.end)
  const to = end
    ? Math.floor(end.getTime() / 1000)
    : rangeMs
      ? Math.floor(Date.now() / 1000)
      : undefined
  const from = start
    ? Math.floor(start.getTime() / 1000)
    : to != null && rangeMs
      ? Math.max(0, to - Math.ceil(rangeMs / 1000))
      : undefined

  if (from != null && to != null && from >= to) {
    return { from, to: undefined }
  }

  return { from, to }
}

function resolveEndpoint(request: MarketSeriesRequest, assetClass?: string): FinnhubEndpoint {
  const override = request.providerParams?.endpoint as string | undefined
  if (override === 'forex' || override === 'crypto' || override === 'stock') {
    return override
  }

  if (assetClass === 'currency') return 'forex'
  if (assetClass === 'crypto') return 'crypto'
  return 'stock'
}

export async function fetchFinnhubSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const endpoint = resolveEndpoint(request, context.assetClass)

  if ((endpoint === 'forex' || context.assetClass === 'currency') && !context.quote) {
    throw new Error('Currency listings require a quote currency for Finnhub forex symbols')
  }

  if ((endpoint === 'crypto' || context.assetClass === 'crypto') && !context.quote) {
    throw new Error('Crypto listings require a quote currency for Finnhub crypto symbols')
  }

  const symbol = resolveProviderSymbol(finnhubProviderConfig, context)
  const { from, to } = resolveTimeRange(request)
  if (from == null || to == null) {
    throw new Error('Finnhub series requests require explicit start and end times')
  }
  const interval = request.interval ?? '1d'
  const resolution = FINNHUB_RESOLUTION_MAP[interval as MarketInterval]
  if (!resolution) throw new Error(`Unsupported Finnhub interval: ${interval}`)

  const apiKey = request.auth?.apiKey

  if (!apiKey) {
    throw new Error('Finnhub API key is required')
  }

  const calendarStock = endpoint === 'stock' && ['D', 'W', 'M'].includes(resolution)
  if (calendarStock && !context.timeZoneName) throw new Error('Finnhub stock timezone is required')
  const formatter = calendarStock
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: context.timeZoneName,
        timeZoneName: 'longOffset',
      })
    : undefined

  const endpointKey =
    endpoint === 'stock' ? 'default' : endpoint === 'forex' ? 'currency' : 'crypto'
  const seriesEndpoint = finnhubProviderConfig.api_endpoints?.[endpointKey]
  if (!seriesEndpoint) {
    throw new Error('Finnhub endpoint is not configured for series requests')
  }
  const url = new URL(seriesEndpoint)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('resolution', resolution)
  url.searchParams.set('from', String(from))
  url.searchParams.set('to', String(to))

  logger.info('Fetching Finnhub candles', {
    listing: context.listing,
    symbol,
    endpoint,
    resolution,
    from,
    to,
  })

  const payload = await fetchMarketProviderJson<{
    c?: number[]
    h?: number[]
    l?: number[]
    o?: number[]
    t?: number[]
    v?: number[]
    s?: string
    error?: string
  }>(finnhubProviderConfig, apiKey, url.toString(), {
    headers: {
      'X-Finnhub-Token': apiKey,
      Accept: 'application/json',
    },
  })

  if (!payload || payload.s !== 'ok') {
    throw new Error(payload?.error || 'No candle data returned')
  }

  const times = payload.t || []
  const bars: MarketBar[] = []

  for (let i = 0; i < times.length; i += 1) {
    const close = payload.c?.[i]
    if (close == null) continue

    let timeStamp = new Date(times[i] * 1000).toISOString()
    // Calendar labels at UTC midnight represent a trading date, not an instant.
    if (formatter && timeStamp.endsWith('T00:00:00.000Z')) {
      timeStamp = toZonedIsoTimestamp(timeStamp.slice(0, 10), formatter)!
    }
    bars.push({
      timeStamp,
      open: payload.o?.[i],
      high: payload.h?.[i],
      low: payload.l?.[i],
      close,
      volume: payload.v?.[i],
    })
  }

  const start = bars[0]?.timeStamp ?? toDate(request.start)?.toISOString()
  const end = bars.length ? bars[bars.length - 1]?.timeStamp : toDate(request.end)?.toISOString()

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start,
    end,
    timezone: context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
