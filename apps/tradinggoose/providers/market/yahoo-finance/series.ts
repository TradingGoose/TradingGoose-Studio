import { createLogger } from '@/lib/logs/console/logger'
import type {
  MarketBar,
  MarketSeries,
  MarketSeriesRequest,
  MarketInterval,
  NormalizationMode,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { YahooFinanceProviderConfig } from '@/providers/market/yahoo-finance/config'

const logger = createLogger('MarketProvider:YFinance')

const NORMALIZED_CLOSE_MODES: NormalizationMode[] = ['adjusted']

const YAHOO_INTERVAL_MAP: Partial<Record<MarketInterval, string>> = {
  '1m': '1m',
  '2m': '2m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '60m',
  '1d': '1d',
  '1w': '1wk',
  '1mo': '1mo',
  '3mo': '3mo',
}
const YAHOO_INTERVALS = new Set([
  '1m',
  '2m',
  '5m',
  '15m',
  '30m',
  '60m',
  '1h',
  '1d',
  '1wk',
  '1mo',
  '3mo',
])

function toUnixSeconds(value?: string | number): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value)
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000)
    }
  }
  return undefined
}

function toIsoString(value?: string | number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

function resolveInterval(request: MarketSeriesRequest): string {
  const interval =
    request.interval || (request.providerParams?.interval as string | undefined)
  if (!interval) return '1d'
  const mapped = YAHOO_INTERVAL_MAP[interval as MarketInterval]
  if (mapped) return mapped
  if (YAHOO_INTERVALS.has(interval)) return interval
  return '1d'
}

function buildChartUrl(symbol: string, request: MarketSeriesRequest): string {
  const params = new URLSearchParams()
  const interval = resolveInterval(request)
  params.set('interval', interval)

  const period1 = toUnixSeconds(request.start)
  const period2 = toUnixSeconds(request.end)
  const isIntraday = /m$/i.test(interval) || /h$/i.test(interval)
  const rangeOverride = request.providerParams?.range as string | undefined

  if (period1 && period2) {
    params.set('period1', String(period1))
    params.set('period2', String(period2))
  } else if (rangeOverride) {
    params.set('range', rangeOverride)
  } else {
    params.set('range', isIntraday ? '7d' : '1mo')
  }

  params.set('events', 'div,split')

  const baseUrl = YahooFinanceProviderConfig.api_endpoints?.default
  if (!baseUrl) {
    throw new Error('Yahoo Finance endpoint is not configured for series requests')
  }

  return `${baseUrl}/${encodeURIComponent(symbol)}?${params.toString()}`
}

export async function fetchYahooFinanceSeries(
  request: MarketSeriesRequest
): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const symbol = resolveProviderSymbol(YahooFinanceProviderConfig, context)
  const interval = resolveInterval(request)
  const url = buildChartUrl(symbol, request)

  logger.info('Fetching Yahoo Finance chart', {
    listing: context.listing,
    symbol,
    interval,
    start: request.start,
    end: request.end,
  })

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Yahoo Finance request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as any
  const result = payload?.chart?.result?.[0]
  const error = payload?.chart?.error

  if (!result) {
    throw new Error(error?.description || 'No chart data returned')
  }

  const timestamps: number[] = result.timestamp || []
  const indicators = result.indicators || {}
  const quote = indicators.quote?.[0] || {}
  const adjCloseSeries: number[] | undefined = indicators.adjclose?.[0]?.adjclose

  const useAdjustedClose =
    request.normalizationMode && NORMALIZED_CLOSE_MODES.includes(request.normalizationMode)

  const bars: MarketBar[] = []

  for (let i = 0; i < timestamps.length; i += 1) {
    const closeRaw = quote.close?.[i]
    const closeAdj = adjCloseSeries?.[i]
    const closeValue = useAdjustedClose && closeAdj != null ? closeAdj : closeRaw

    if (closeValue == null) continue

    bars.push({
      timeStamp: new Date(timestamps[i] * 1000).toISOString(),
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: closeValue,
      volume: quote.volume?.[i],
    })
  }

  const start = bars[0]?.timeStamp ?? toIsoString(request.start)
  const end = bars.length ? bars[bars.length - 1]?.timeStamp : toIsoString(request.end)

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    primaryMicCode: context.micCode ?? context.primaryMicCode,
    start,
    end,
    timezone: result.meta?.exchangeTimezoneName || context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
