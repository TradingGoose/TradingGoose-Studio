import { createLogger } from '@/lib/logs/console/logger'
import type {
  MarketBar,
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

function resolveTimeRange(request: MarketSeriesRequest): { start?: string; end?: string } {
  const now = Date.now()
  const end = toIsoString(request.end ?? now) ?? new Date(now).toISOString()
  const startFallback = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()
  const start = toIsoString(request.start) ?? startFallback

  if (start && end) {
    const startMs = Date.parse(start)
    const endMs = Date.parse(end)
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs >= endMs) {
      return { start: startFallback, end: new Date(now).toISOString() }
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

function resolveMarket(request: MarketSeriesRequest, assetClass?: string): 'stocks' | 'crypto' {
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

function resolveCredentials(params?: Record<string, any>): {
  keyId?: string
  secretKey?: string
} {
  const keyId =
    (params?.apiKey as string | undefined) || process.env.ALPACA_API_KEY_ID

  const secretKey =
    (params?.apiSecret as string | undefined) || process.env.ALPACA_API_SECRET_KEY

  return { keyId, secretKey }
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

  const { start, end } = resolveTimeRange(request)
  const { keyId, secretKey } = resolveCredentials(request.providerParams)

  if (market === 'stocks' && (!keyId || !secretKey)) {
    throw new Error('Alpaca API key ID and secret key are required for stock market data')
  }

  const cryptoRegion = String(
    request.providerParams?.region ?? request.providerParams?.cryptoRegion ?? 'us'
  ).toLowerCase()

  const url =
    market === 'crypto'
      ? new URL(`https://data.alpaca.markets/v1beta3/crypto/${cryptoRegion}/bars`)
      : new URL('https://data.alpaca.markets/v2/stocks/bars')

  url.searchParams.set('symbols', symbol)
  url.searchParams.set('timeframe', timeframe)
  if (start) url.searchParams.set('start', start)
  if (end) url.searchParams.set('end', end)

  const limit = request.providerParams?.limit as string | number | undefined
  if (limit) url.searchParams.set('limit', String(limit))

  const sort = request.providerParams?.sort as string | undefined
  if (sort) url.searchParams.set('sort', sort)

  const asof = toIsoString(request.providerParams?.asof as string | number | undefined)
  if (asof) url.searchParams.set('asof', asof)

  const currency = request.providerParams?.currency as string | undefined
  if (currency) url.searchParams.set('currency', currency)

  if (market === 'stocks') {
    const feed = request.providerParams?.feed as string | undefined
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
    listing: context.listingKey,
    symbol,
    market,
    timeframe,
    start,
    end,
  })

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (keyId && secretKey) {
    headers['APCA-API-KEY-ID'] = keyId
    headers['APCA-API-SECRET-KEY'] = secretKey
  }

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
    throw new Error('No bar data returned')
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
    listing: request.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    primaryMicCode: context.micCode ?? context.primaryMicCode,
    start: startTime,
    end: endTime,
    timezone: context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
