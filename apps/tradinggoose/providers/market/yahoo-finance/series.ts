import { createLogger } from '@/lib/logs/console/logger'
import { getMarketQuoteDate } from '@/lib/market/quote-snapshot-contract'
import { resolveTimezoneState } from '@/lib/timezone/timezone-resolver'
import { toDate } from '@/providers/market/market-hours/date-utils'
import { resolveMarketSeriesNormalizationMode } from '@/providers/market/providers'
import type {
  MarketBar,
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { YahooFinanceProviderConfig } from '@/providers/market/yahoo-finance/config'

const logger = createLogger('MarketProvider:YFinance')

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

function buildChartUrl(symbol: string, interval: string, request: MarketSeriesRequest): string {
  const params = new URLSearchParams()
  params.set('interval', interval)

  const period1 = toDate(request.start)
  const period2 = toDate(request.end)
  const isIntraday = /m$/i.test(interval) || /h$/i.test(interval)
  const rangeOverride = request.providerParams?.range as string | undefined
  const marketSession = String(request.providerParams?.marketSession ?? '').toLowerCase()

  if (request.windows?.[0]?.mode === 'all') {
    params.set('range', 'max')
  } else if (period1 && period2) {
    params.set('period1', String(Math.floor(period1.getTime() / 1000)))
    params.set('period2', String(Math.floor(period2.getTime() / 1000)))
  } else if (rangeOverride) {
    params.set('range', rangeOverride)
  } else {
    params.set('range', isIntraday ? '7d' : '1mo')
  }

  params.set('events', 'div,split')
  if (marketSession === 'extended') {
    params.set('includePrePost', 'true')
  }

  const baseUrl = YahooFinanceProviderConfig.api_endpoints?.default
  if (!baseUrl) {
    throw new Error('Yahoo Finance endpoint is not configured for series requests')
  }

  return `${baseUrl}/${encodeURIComponent(symbol)}?${params.toString()}`
}

export async function fetchYahooFinanceSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const symbol = resolveProviderSymbol(YahooFinanceProviderConfig, context)
  const intervalId = request.interval ?? '1d'
  const interval = YAHOO_INTERVAL_MAP[intervalId as MarketInterval]
  if (!interval) throw new Error('Unsupported Yahoo Finance interval')
  if (
    request.normalizationMode &&
    !resolveMarketSeriesNormalizationMode('yahoo-finance', request.normalizationMode, intervalId)
  ) {
    throw new Error('Unsupported Yahoo Finance price normalization for this interval')
  }
  const url = buildChartUrl(symbol, interval, request)

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

  const dailyCurrency = request.listing.listing_type === 'currency' && interval === '1d'
  let sourceTimezone = result.meta?.exchangeTimezoneName
  if (dailyCurrency) {
    if (!sourceTimezone) throw new Error('Yahoo Finance currency timezone is required')
    sourceTimezone = (await resolveTimezoneState(sourceTimezone)).name
  }
  const timestamps: number[] = result.timestamp || []
  const indicators = result.indicators || {}
  const quote = indicators.quote?.[0] || {}
  const adjCloseSeries: number[] | undefined = indicators.adjclose?.[0]?.adjclose

  const bars: MarketBar[] = []

  for (let i = 0; i < timestamps.length; i += 1) {
    const closeRaw = quote.close?.[i]
    const closeAdj = adjCloseSeries?.[i]
    const closeValue = request.normalizationMode === 'adjusted' ? closeAdj : closeRaw

    if (closeValue == null) continue

    const timeStamp = new Date(timestamps[i] * 1000).toISOString()
    bars.push({
      timeStamp: dailyCurrency
        ? `${getMarketQuoteDate(timeStamp, sourceTimezone)}T00:00:00.000Z`
        : timeStamp,
      open: quote.open?.[i],
      high: quote.high?.[i],
      low: quote.low?.[i],
      close: closeValue,
      volume: quote.volume?.[i],
    })
  }

  const start = bars[0]?.timeStamp ?? toDate(request.start)?.toISOString()
  const end = bars.at(-1)?.timeStamp ?? toDate(request.end)?.toISOString()

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start,
    end,
    timezone: dailyCurrency ? 'UTC' : context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
