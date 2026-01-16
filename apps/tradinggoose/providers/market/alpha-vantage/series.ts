import { createLogger } from '@/lib/logs/console/logger'
import type { MarketBar, MarketSeries, MarketSeriesRequest, NormalizationMode } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { alphaVantageProviderConfig } from '@/providers/market/alpha-vantage/config'

const logger = createLogger('MarketProvider:AlphaVantage')

const DEFAULT_INTERVAL = '1d'

const INTRADAY_INTERVAL_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '60min',
}

const OUTPUTSIZE_FUNCTIONS = new Set([
  'TIME_SERIES_INTRADAY',
  'TIME_SERIES_DAILY',
  'TIME_SERIES_DAILY_ADJUSTED',
  'FX_INTRADAY',
  'FX_DAILY',
  'CRYPTO_INTRADAY',
])

type SeriesType = 'equity' | 'fx' | 'crypto' | 'digital'

function resolveInterval(request: MarketSeriesRequest): string {
  return request.interval || (request.providerParams?.interval as string | undefined) || DEFAULT_INTERVAL
}

function resolveApiKey(params?: Record<string, any>): string | undefined {
  return (params?.apiKey as string | undefined) || process.env.ALPHAVANTAGE_API_KEY
}

function isIntradayInterval(interval: string): interval is keyof typeof INTRADAY_INTERVAL_MAP {
  return Object.prototype.hasOwnProperty.call(INTRADAY_INTERVAL_MAP, interval)
}

function shouldUseAdjusted(mode?: NormalizationMode): boolean {
  return Boolean(mode && mode !== 'raw')
}

function resolveEquityFunction(interval: string, useAdjusted: boolean): {
  functionName: string
  intervalParam?: string
} {
  if (isIntradayInterval(interval)) {
    return { functionName: 'TIME_SERIES_INTRADAY', intervalParam: INTRADAY_INTERVAL_MAP[interval] }
  }

  if (interval === '1w') {
    return { functionName: useAdjusted ? 'TIME_SERIES_WEEKLY_ADJUSTED' : 'TIME_SERIES_WEEKLY' }
  }

  if (interval === '1mo') {
    return { functionName: useAdjusted ? 'TIME_SERIES_MONTHLY_ADJUSTED' : 'TIME_SERIES_MONTHLY' }
  }

  return { functionName: useAdjusted ? 'TIME_SERIES_DAILY_ADJUSTED' : 'TIME_SERIES_DAILY' }
}

function resolveFxFunction(interval: string): { functionName: string; intervalParam?: string } {
  if (isIntradayInterval(interval)) {
    return { functionName: 'FX_INTRADAY', intervalParam: INTRADAY_INTERVAL_MAP[interval] }
  }

  if (interval === '1w') return { functionName: 'FX_WEEKLY' }
  if (interval === '1mo') return { functionName: 'FX_MONTHLY' }

  return { functionName: 'FX_DAILY' }
}

function resolveCryptoFunction(interval: string): { functionName: string; intervalParam?: string; type: SeriesType } {
  if (isIntradayInterval(interval)) {
    return { functionName: 'CRYPTO_INTRADAY', intervalParam: INTRADAY_INTERVAL_MAP[interval], type: 'crypto' }
  }

  if (interval === '1w') return { functionName: 'DIGITAL_CURRENCY_WEEKLY', type: 'digital' }
  if (interval === '1mo') return { functionName: 'DIGITAL_CURRENCY_MONTHLY', type: 'digital' }

  return { functionName: 'DIGITAL_CURRENCY_DAILY', type: 'digital' }
}

function extractSeries(payload: Record<string, any>): { series?: Record<string, any>; meta?: Record<string, string> } {
  const meta = (payload['Meta Data'] || payload['Meta data'] || payload['MetaData']) as
    | Record<string, string>
    | undefined
  const seriesKey = Object.keys(payload).find((key) => /Time Series/i.test(key))
  const series = seriesKey ? (payload[seriesKey] as Record<string, any>) : undefined
  return { series, meta }
}

function extractTimezone(meta?: Record<string, string>): string | undefined {
  if (!meta) return undefined
  const key = Object.keys(meta).find((entry) => /time zone/i.test(entry))
  return key ? meta[key] : undefined
}

function toMillis(value?: string | number): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toIsoTimestamp(raw: string): string | undefined {
  if (!raw) return undefined
  const normalized = raw.includes(' ')
    ? `${raw.replace(' ', 'T')}Z`
    : `${raw}T00:00:00Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readField(entry: Record<string, any>, key: string): number | undefined {
  return parseNumber(entry[key])
}

function parseStandardBar(
  entry: Record<string, any>,
  useAdjusted: boolean
): { open?: number; high?: number; low?: number; close?: number; volume?: number } {
  const closeRaw = readField(entry, '4. close')
  const adjustedClose = readField(entry, '5. adjusted close')
  const close = useAdjusted ? adjustedClose ?? closeRaw : closeRaw

  const volume = useAdjusted
    ? readField(entry, '6. volume') ?? readField(entry, '5. volume')
    : readField(entry, '5. volume')

  return {
    open: readField(entry, '1. open'),
    high: readField(entry, '2. high'),
    low: readField(entry, '3. low'),
    close,
    volume,
  }
}

function parseDigitalBar(
  entry: Record<string, any>,
  market: string
): { open?: number; high?: number; low?: number; close?: number; volume?: number } {
  const code = market.toUpperCase()
  const open =
    readField(entry, `1a. open (${code})`) ??
    readField(entry, `1b. open (${code})`) ??
    readField(entry, '1a. open (USD)') ??
    readField(entry, '1b. open (USD)')

  const high =
    readField(entry, `2a. high (${code})`) ??
    readField(entry, `2b. high (${code})`) ??
    readField(entry, '2a. high (USD)') ??
    readField(entry, '2b. high (USD)')

  const low =
    readField(entry, `3a. low (${code})`) ??
    readField(entry, `3b. low (${code})`) ??
    readField(entry, '3a. low (USD)') ??
    readField(entry, '3b. low (USD)')

  const close =
    readField(entry, `4a. close (${code})`) ??
    readField(entry, `4b. close (${code})`) ??
    readField(entry, '4a. close (USD)') ??
    readField(entry, '4b. close (USD)')

  return {
    open,
    high,
    low,
    close,
    volume: readField(entry, '5. volume'),
  }
}

function parseBars(
  series: Record<string, any>,
  type: SeriesType,
  useAdjusted: boolean,
  market: string
): MarketBar[] {
  const bars: MarketBar[] = []

  Object.entries(series).forEach(([timestamp, entry]) => {
    const timeStamp = toIsoTimestamp(timestamp)
    if (!timeStamp || !entry || typeof entry !== 'object') return

    const parsed =
      type === 'digital'
        ? parseDigitalBar(entry as Record<string, any>, market)
        : parseStandardBar(entry as Record<string, any>, useAdjusted)

    if (parsed.close == null) return

    bars.push({
      timeStamp,
      open: parsed.open,
      high: parsed.high,
      low: parsed.low,
      close: parsed.close,
      volume: parsed.volume,
    })
  })

  bars.sort((a, b) => new Date(a.timeStamp).getTime() - new Date(b.timeStamp).getTime())
  return bars
}

function filterBarsByRange(
  bars: MarketBar[],
  start?: string | number,
  end?: string | number
): MarketBar[] {
  const startMs = toMillis(start)
  const endMs = toMillis(end)
  if (!startMs && !endMs) return bars

  return bars.filter((bar) => {
    const ts = Date.parse(bar.timeStamp)
    if (!Number.isFinite(ts)) return false
    if (startMs && ts < startMs) return false
    if (endMs && ts > endMs) return false
    return true
  })
}

export async function fetchAlphaVantageSeries(
  request: MarketSeriesRequest
): Promise<MarketSeries> {
  const apiKey = resolveApiKey(request.providerParams)
  if (!apiKey) {
    throw new Error('Alpha Vantage API key is required')
  }

  const context = await resolveListingContext(request.listing)
  const assetClass = context.assetClass
  const interval = resolveInterval(request)
  const useAdjusted = shouldUseAdjusted(request.normalizationMode)

  let functionName = ''
  let intervalParam: string | undefined
  let seriesType: SeriesType = 'equity'
  let symbolParam: Record<string, string> = {}

  if (assetClass === 'currency') {
    if (!context.quote) {
      throw new Error('Currency listings require a quote currency for Alpha Vantage')
    }
    const resolved = resolveFxFunction(interval)
    functionName = resolved.functionName
    intervalParam = resolved.intervalParam
    seriesType = 'fx'
    symbolParam = {
      from_symbol: context.base,
      to_symbol: context.quote,
    }
  } else if (assetClass === 'crypto') {
    if (!context.quote) {
      throw new Error('Crypto listings require a quote currency for Alpha Vantage')
    }
    const resolved = resolveCryptoFunction(interval)
    functionName = resolved.functionName
    intervalParam = resolved.intervalParam
    seriesType = resolved.type
    symbolParam = {
      symbol: context.base,
      market: context.quote,
    }
  } else {
    const symbol = resolveProviderSymbol(alphaVantageProviderConfig, context)
    const resolved = resolveEquityFunction(interval, useAdjusted)
    functionName = resolved.functionName
    intervalParam = resolved.intervalParam
    seriesType = 'equity'
    symbolParam = { symbol }
  }

  if (!functionName) {
    throw new Error('Unsupported Alpha Vantage series request')
  }

  const seriesEndpoint =
    alphaVantageProviderConfig.api_endpoints?.[assetClass ?? 'default'] ||
    alphaVantageProviderConfig.api_endpoints?.default

  if (!seriesEndpoint) {
    throw new Error('Alpha Vantage endpoint is not configured for series requests')
  }

  const url = new URL(seriesEndpoint)
  url.searchParams.set('function', functionName)
  url.searchParams.set('apikey', apiKey)
  Object.entries(symbolParam).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  if (intervalParam) {
    url.searchParams.set('interval', intervalParam)
  }

  if (OUTPUTSIZE_FUNCTIONS.has(functionName)) {
    url.searchParams.set('outputsize', 'full')
  }

  logger.info('Fetching Alpha Vantage series', {
    listing: context.listing,
    functionName,
    interval: intervalParam ?? interval,
  })

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Alpha Vantage request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as Record<string, any>
  const message = payload['Error Message'] || payload.Information || payload.Note
  if (message) {
    throw new Error(message)
  }

  const { series, meta } = extractSeries(payload)
  if (!series || !Object.keys(series).length) {
    throw new Error('No series data returned')
  }

  const market = context.quote || 'USD'
  const bars = parseBars(series, seriesType, useAdjusted, market)
  const filteredBars = filterBarsByRange(bars, request.start, request.end)

  if (!filteredBars.length) {
    throw new Error('No data returned for the requested time range')
  }

  const timezone = extractTimezone(meta) || context.timeZoneName

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    primaryMicCode: context.micCode ?? context.primaryMicCode,
    start: filteredBars[0]?.timeStamp,
    end: filteredBars[filteredBars.length - 1]?.timeStamp,
    timezone,
    normalizationMode: request.normalizationMode,
    bars: filteredBars,
  }
}
