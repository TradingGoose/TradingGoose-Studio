import { createLogger } from '@/lib/logs/console/logger'
import type {
  MarketBar,
  MarketRequestBase,
  MarketSeries,
  MarketSeriesRequest,
  MarketInterval,
  NormalizationMode,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'

const logger = createLogger('MarketProvider:Alpaca')

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
const ALPACA_TIMEFRAMES = new Set(Object.values(ALPACA_INTERVAL_MAP))
const DEFAULT_TIMEFRAME = ALPACA_INTERVAL_MAP['1d'] ?? '1Day'

const DAY_MS = 24 * 60 * 60 * 1000

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

function parseRangeMs(range?: string): number | null {
  if (!range) return null
  const match = String(range).trim().toLowerCase().match(/^(\d+)(d|w|mo|y)$/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2]
  if (unit === 'd') return value * DAY_MS
  if (unit === 'w') return value * 7 * DAY_MS
  if (unit === 'mo') return value * 30 * DAY_MS
  if (unit === 'y') return value * 365 * DAY_MS
  return null
}

export function intervalToMs(interval?: string): number | null {
  if (!interval) return null
  const match = String(interval).trim().toLowerCase().match(/^(\d+)(mo|m|h|d|w)$/)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  const unit = match[2]
  if (unit === 'm') return value * 60 * 1000
  if (unit === 'h') return value * 60 * 60 * 1000
  if (unit === 'd') return value * DAY_MS
  if (unit === 'w') return value * 7 * DAY_MS
  if (unit === 'mo') return value * 30 * DAY_MS
  return null
}

function resolveTimeRange(request: MarketSeriesRequest): { start?: string; end?: string } {
  const start = toIsoString(request.start)
  const end = toIsoString(request.end)

  if (start && end) {
    const startMs = Date.parse(start)
    const endMs = Date.parse(end)
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= endMs) {
      return { start, end: undefined }
    }
  }

  return { start, end }
}

function resolveTimeframe(interval?: string): string {
  if (!interval) return DEFAULT_TIMEFRAME
  const mapped = ALPACA_INTERVAL_MAP[interval as MarketInterval]
  if (mapped) return mapped
  if (ALPACA_TIMEFRAMES.has(interval)) return interval
  return DEFAULT_TIMEFRAME
}

const NORMALIZATION_TO_ADJUSTMENT: Partial<Record<NormalizationMode, string>> = {
  raw: 'raw',
  scaled_raw: 'raw',
  split_adjusted: 'split',
  adjusted: 'all',
  total_return: 'all',
}

function resolveAdjustment(
  mode: NormalizationMode | undefined,
  override?: string
): string | undefined {
  if (override) return override
  if (!mode) return undefined
  return NORMALIZATION_TO_ADJUSTMENT[mode]
}

export function resolveMarket(
  request: MarketRequestBase,
  assetClass?: string
): 'stocks' | 'crypto' {
  const override = String(
    request.providerParams?.market ??
      request.providerParams?.alpacaMarket ??
      request.providerParams?.assetClass ??
      request.providerParams?.endpoint ??
      ''
  ).toLowerCase()

  if (override === 'crypto') return 'crypto'
  if (override === 'stocks' || override === 'stock' || override === 'equity') return 'stocks'

  if (assetClass === 'crypto') return 'crypto'
  return 'stocks'
}

export function resolveCredentials(auth?: { apiKey?: string; apiSecret?: string }): {
  keyId?: string
  secretKey?: string
} {
  return {
    keyId: auth?.apiKey,
    secretKey: auth?.apiSecret,
  }
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
    throw new Error(
      errorText || `Alpaca latest bar request failed with status ${response.status}`
    )
  }

  const payload = (await response.json()) as {
    bars?: Record<string, any>
    bar?: any
  }

  const bars = payload?.bars
  const bar =
    (bars && (bars[symbol] || bars[symbol.toUpperCase()] || bars[symbol.toLowerCase()])) ||
    payload?.bar
  const timeValue = bar?.t ?? bar?.timestamp ?? bar?.time
  return toIsoString(timeValue)
}

function resolveBars(payload: any, symbol: string): any[] {
  const bars = payload?.bars
  if (Array.isArray(bars)) return bars
  if (bars && typeof bars === 'object') {
    return (
      bars[symbol] ||
      bars[symbol.toUpperCase()] ||
      bars[symbol.toLowerCase()] ||
      Object.values(bars)[0]
    ) as any[]
  }
  return []
}

export async function fetchAlpacaSeries(
  request: MarketSeriesRequest
): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const market = resolveMarket(request, context.assetClass)

  if (market === 'crypto' && !context.quote) {
    throw new Error('Crypto listings require a quote currency for Alpaca symbols')
  }

  const symbol = resolveProviderSymbol(alpacaProviderConfig, context)

  const timeframe = resolveTimeframe(
    request.interval || (request.providerParams?.interval as string | undefined)
  )

  const { keyId, secretKey } = resolveCredentials(request.auth)

  if (market === 'stocks' && (!keyId || !secretKey)) {
    throw new Error('Alpaca API key ID and secret key are required for stock market data')
  }

  const cryptoRegion = String(
    request.providerParams?.region ?? request.providerParams?.cryptoRegion ?? 'us'
  ).toLowerCase()

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (keyId && secretKey) {
    headers['APCA-API-KEY-ID'] = keyId
    headers['APCA-API-SECRET-KEY'] = secretKey
  }

  const limit = request.providerParams?.limit as string | number | undefined
  const sort = request.providerParams?.sort as string | undefined
  const feed =
    market === 'stocks'
      ? (request.providerParams?.feed as string | undefined) ||
        (request.providerParams?.dataFeed as string | undefined) ||
        'iex'
      : undefined

  const { start: explicitStart, end: explicitEnd } = resolveTimeRange(request)
  let start = explicitStart
  let end = explicitEnd

  if (!start && !end && limit && market === 'stocks') {
    const latestEnd = await fetchLatestBarTimestamp(symbol, feed, headers)
    const rangeParam = request.providerParams?.range as string | undefined
    const intervalMs = intervalToMs(
      request.interval || (request.providerParams?.interval as string | undefined)
    )
    const rangeMs =
      parseRangeMs(rangeParam) ||
      (intervalMs && Number.isFinite(Number(limit))
        ? Number(limit) * intervalMs
        : null)

    if (latestEnd && rangeMs && Number.isFinite(rangeMs)) {
      const endMs = Date.parse(latestEnd)
      if (Number.isFinite(endMs)) {
        end = new Date(endMs).toISOString()
        start = new Date(endMs - rangeMs).toISOString()
      }
    }
  }

  const url =
    market === 'crypto'
      ? new URL(`https://data.alpaca.markets/v1beta3/crypto/${cryptoRegion}/bars`)
      : new URL('https://data.alpaca.markets/v2/stocks/bars')

  url.searchParams.set('symbols', symbol)
  url.searchParams.set('timeframe', timeframe)
  if (start) url.searchParams.set('start', start)
  if (end) url.searchParams.set('end', end)

  if (limit) url.searchParams.set('limit', String(limit))

  const shouldDefaultSort = !sort && limit && !start && !end
  if (sort || shouldDefaultSort) {
    url.searchParams.set('sort', sort ?? 'desc')
  }

  const asof = toIsoString(request.providerParams?.asof as string | number | undefined)
  if (asof) url.searchParams.set('asof', asof)

  const currency = request.providerParams?.currency as string | undefined
  if (currency) url.searchParams.set('currency', currency)

  if (market === 'stocks') {
    if (feed) url.searchParams.set('feed', feed)

    const adjustment = resolveAdjustment(
      request.normalizationMode,
      request.providerParams?.adjustment as string | undefined
    )
    if (adjustment) url.searchParams.set('adjustment', adjustment)

    const pageToken =
      (request.providerParams?.pageToken as string | undefined) ||
      (request.providerParams?.page_token as string | undefined)
    if (pageToken) url.searchParams.set('page_token', pageToken)
  }

  logger.info('Fetching Alpaca bars', {
    listing: context.listing,
    symbol,
    market,
    timeframe,
    start,
    end,
    limit,
    sort: sort ?? (limit && !start && !end ? 'desc' : undefined),
    feed: market === 'stocks' ? url.searchParams.get('feed') : undefined,
  })

  const response = await fetch(url.toString(), { headers })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Alpaca request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    bars?: Record<string, any[]> | any[]
    next_page_token?: string | null
  }

  const rawBars = resolveBars(payload, symbol)
  if (!Array.isArray(rawBars) || !rawBars.length) {
    const allowEmpty = request.providerParams?.allowEmpty === true
    if (!allowEmpty) {
      throw new Error('No bar data returned')
    }
    const startTime = toIsoString(request.start)
    const endTime = toIsoString(request.end)
    return {
      listing: context.listing,
      listingBase: context.base,
      listingQuote: context.quote,
      marketCode: context.marketCode,
      start: startTime,
      end: endTime,
      timezone: context.timeZoneName,
      normalizationMode: request.normalizationMode,
      bars: [],
    }
  }

  const bars: MarketBar[] = []

  rawBars.forEach((bar) => {
    const close = bar?.c ?? bar?.close
    if (close == null) return

    const timeValue = bar?.t ?? bar?.timestamp ?? bar?.time
    if (!timeValue) return

    const timeStamp = toIsoString(timeValue)
    if (!timeStamp) return

    bars.push({
      timeStamp,
      open: bar?.o ?? bar?.open,
      high: bar?.h ?? bar?.high,
      low: bar?.l ?? bar?.low,
      close,
      volume: bar?.v ?? bar?.volume,
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
