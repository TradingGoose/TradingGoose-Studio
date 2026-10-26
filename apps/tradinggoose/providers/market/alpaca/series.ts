import { createLogger } from '@/lib/logs/console/logger'
import {
  ALPACA_MAX_BARS,
  ALPACA_PAGE_SIZE,
  alpacaProviderConfig,
} from '@/providers/market/alpaca/config'
import { toDate } from '@/providers/market/market-hours/date-utils'
import { rangeToMs } from '@/providers/market/series-window'
import type {
  MarketBar,
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
  NormalizationMode,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

const logger = createLogger('MarketProvider:Alpaca')
const MAX_EMPTY_PAGES = 100

const ALPACA_INTERVAL_MAP: Partial<Record<MarketInterval, string>> = {
  '1m': '1Min',
  '2m': '2Min',
  '3m': '3Min',
  '5m': '5Min',
  '10m': '10Min',
  '15m': '15Min',
  '30m': '30Min',
  '45m': '45Min',
  '1h': '1Hour',
  '2h': '2Hour',
  '3h': '3Hour',
  '4h': '4Hour',
  '1d': '1Day',
  '1w': '1Week',
  '1mo': '1Month',
  '3mo': '3Month',
  '6mo': '6Month',
  '12mo': '12Month',
}

const NORMALIZATION_TO_ADJUSTMENT: Partial<Record<NormalizationMode, string>> = {
  raw: 'raw',
  scaled_raw: 'raw',
  split_adjusted: 'split',
  adjusted: 'all',
  total_return: 'all',
}

async function fetchLatestBarTimestamp(
  symbol: string,
  feed: string | undefined,
  headers: Record<string, string>
): Promise<string | undefined> {
  const url = new URL('https://data.alpaca.markets/v2/stocks/bars/latest')
  url.searchParams.set('symbols', symbol)
  if (feed) url.searchParams.set('feed', feed)

  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Alpaca latest bar request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    bars?: Record<string, any>
  }
  return toDate(payload?.bars?.[symbol]?.t)?.toISOString()
}

export async function fetchAlpacaSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const market = context.assetClass === 'crypto' ? 'crypto' : 'stocks'

  if (market === 'crypto' && !context.quote) {
    throw new Error('Crypto listings require a quote currency for Alpaca symbols')
  }

  const symbol = resolveProviderSymbol(alpacaProviderConfig, context)

  const interval = request.interval || request.providerParams?.interval || '1d'
  const timeframe = ALPACA_INTERVAL_MAP[interval as MarketInterval]
  if (!timeframe) throw new Error(`Unsupported Alpaca interval: ${interval}`)

  const { apiKey, apiSecret } = request.auth ?? {}

  if (market === 'stocks' && (!apiKey || !apiSecret)) {
    throw new Error('Alpaca API key ID and secret key are required for stock market data')
  }

  const cryptoRegion = String(request.providerParams?.cryptoRegion ?? 'us').toLowerCase()

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (apiKey && apiSecret) {
    headers['APCA-API-KEY-ID'] = apiKey
    headers['APCA-API-SECRET-KEY'] = apiSecret
  }

  const feed =
    market === 'stocks' ? (request.providerParams?.feed as string | undefined) || 'iex' : undefined

  let start = toDate(request.start)?.toISOString()
  let end = toDate(request.end)?.toISOString()
  const window = request.windows?.[0]
  const limit = Number(request.providerParams?.limit)
  const bounded = Boolean(start || end || request.windows?.length)
  const countLimit =
    !bounded && Number.isFinite(limit) && limit > 0
      ? Math.min(Math.max(1, Math.floor(limit)), ALPACA_PAGE_SIZE)
      : undefined
  const rangeMs = window?.mode === 'range' ? rangeToMs(window.range) : null
  if (countLimit) start = new Date(0).toISOString()

  if (!start && !end && rangeMs) {
    const endMs =
      market === 'crypto'
        ? Date.now()
        : Date.parse((await fetchLatestBarTimestamp(symbol, feed, headers)) ?? '')
    if (Number.isFinite(endMs)) {
      end = new Date(endMs).toISOString()
      start = new Date(Math.max(0, endMs - rangeMs)).toISOString()
    }
  }

  const pageLimit = bounded ? ALPACA_PAGE_SIZE : countLimit
  const sort =
    (request.providerParams?.sort as string | undefined) || (countLimit ? 'desc' : undefined)

  const url =
    market === 'crypto'
      ? new URL(`https://data.alpaca.markets/v1beta3/crypto/${cryptoRegion}/bars`)
      : new URL('https://data.alpaca.markets/v2/stocks/bars')

  url.searchParams.set('symbols', symbol)
  url.searchParams.set('timeframe', timeframe)
  if (start) url.searchParams.set('start', start)
  if (end) url.searchParams.set('end', end)

  if (pageLimit) url.searchParams.set('limit', String(pageLimit))
  if (sort) url.searchParams.set('sort', sort)

  const asof = toDate(request.providerParams?.asof as string | number | undefined)?.toISOString()
  if (asof) url.searchParams.set('asof', asof)

  const currency = request.providerParams?.currency as string | undefined
  if (currency) url.searchParams.set('currency', currency)

  if (market === 'stocks') {
    if (feed) url.searchParams.set('feed', feed)

    const adjustment = request.normalizationMode
      ? NORMALIZATION_TO_ADJUSTMENT[request.normalizationMode]
      : undefined
    if (adjustment) url.searchParams.set('adjustment', adjustment)
  }

  logger.info('Fetching Alpaca bars', {
    listing: context.listing,
    symbol,
    market,
    timeframe,
    start,
    end,
    limit: pageLimit,
    sort,
    feed: market === 'stocks' ? url.searchParams.get('feed') : undefined,
  })

  const rawBars: any[] = []
  const pageTokens = new Set<string>()
  let emptyPages = 0
  while (true) {
    const response = await fetch(url.toString(), { headers })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(errorText || `Alpaca request failed with status ${response.status}`)
    }
    const payload = (await response.json()) as {
      bars?: Record<string, any[]>
      next_page_token?: string | null
    }
    const pageBars = payload?.bars?.[symbol]
    const hasBars = Array.isArray(pageBars) && pageBars.length > 0
    if (hasBars) rawBars.push(...pageBars)
    if (countLimit && rawBars.length >= countLimit) {
      rawBars.length = countLimit
      break
    }
    // Inclusive window endpoints can add one bar beyond the configured interval count.
    if (rawBars.length > ALPACA_MAX_BARS + 1) {
      throw new Error(
        `Alpaca pagination reached the ${ALPACA_MAX_BARS}-bar limit. Narrow the range or use a larger interval.`
      )
    }
    const token = payload.next_page_token
    if (!token) break
    if (pageTokens.has(token)) {
      throw new Error('Alpaca returned a repeated pagination token')
    }
    pageTokens.add(token)
    emptyPages = hasBars ? 0 : emptyPages + 1
    if (emptyPages >= MAX_EMPTY_PAGES) {
      throw new Error(
        `Alpaca pagination returned ${MAX_EMPTY_PAGES} consecutive empty pages. Narrow the range or use a larger interval.`
      )
    }
    url.searchParams.set('page_token', token)
  }
  if (!rawBars.length && request.providerParams?.allowEmpty !== true) {
    throw new Error('No bar data returned')
  }

  const bars: MarketBar[] = []

  rawBars.forEach((bar) => {
    const close = bar?.c
    if (close == null) return

    const timeStamp = toDate(bar.t)?.toISOString()
    if (!timeStamp) return

    bars.push({
      timeStamp,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close,
      volume: bar.v,
    })
  })

  const startTime = bars[0]?.timeStamp ?? start
  const endTime = bars.length ? bars[bars.length - 1]?.timeStamp : end

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start: startTime,
    end: endTime,
    timezone: context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
