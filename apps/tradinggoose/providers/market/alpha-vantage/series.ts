import { createLogger } from '@/lib/logs/console/logger'
import { alphaVantageProviderConfig } from '@/providers/market/alpha-vantage/config'
import { toZonedIsoTimestamp } from '@/providers/market/market-hours/date-utils'
import { resolveMarketSeriesNormalizationMode } from '@/providers/market/providers'
import type { MarketBar, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

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

function resolveInterval(request: MarketSeriesRequest): string {
  return (
    request.interval || (request.providerParams?.interval as string | undefined) || DEFAULT_INTERVAL
  )
}

function isIntradayInterval(interval: string): interval is keyof typeof INTRADAY_INTERVAL_MAP {
  return Object.hasOwn(INTRADAY_INTERVAL_MAP, interval)
}

function resolveEquityFunction(
  interval: string,
  useAdjusted: boolean
): {
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

function resolveCryptoFunction(interval: string): {
  functionName: string
  intervalParam?: string
} {
  if (isIntradayInterval(interval)) {
    return {
      functionName: 'CRYPTO_INTRADAY',
      intervalParam: INTRADAY_INTERVAL_MAP[interval],
    }
  }

  if (interval === '1w') return { functionName: 'DIGITAL_CURRENCY_WEEKLY' }
  if (interval === '1mo') return { functionName: 'DIGITAL_CURRENCY_MONTHLY' }

  return { functionName: 'DIGITAL_CURRENCY_DAILY' }
}

function extractSeries(payload: Record<string, any>): Record<string, any> | undefined {
  const seriesKey = Object.keys(payload).find((key) => /Time Series/i.test(key))
  return seriesKey ? (payload[seriesKey] as Record<string, any>) : undefined
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

function parseNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function readField(entry: Record<string, any>, key: string): number | undefined {
  return parseNumber(entry[key])
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
  functionName: string,
  normalizationMode: MarketSeriesRequest['normalizationMode'],
  market: string,
  formatter: Intl.DateTimeFormat
): MarketBar[] {
  const bars: MarketBar[] = []
  const adjusted = functionName.endsWith('_ADJUSTED')
  const splitAdjusted = adjusted && normalizationMode === 'split_adjusted'
  let splitRatio = 1

  for (const [timestamp, entry] of Object.entries(series).sort(([left], [right]) =>
    right.localeCompare(left)
  )) {
    const timeStamp = toZonedIsoTimestamp(timestamp, formatter)
    if (!timeStamp || !entry || typeof entry !== 'object') continue

    const parsed = functionName.startsWith('DIGITAL_CURRENCY_')
      ? parseDigitalBar(entry, market)
      : {
          open: readField(entry, '1. open'),
          high: readField(entry, '2. high'),
          low: readField(entry, '3. low'),
          close: readField(entry, adjusted && !splitAdjusted ? '5. adjusted close' : '4. close'),
          volume: readField(entry, adjusted ? '6. volume' : '5. volume'),
        }

    if (splitAdjusted) {
      const coefficient = readField(entry, '8. split coefficient')
      if (coefficient === undefined || coefficient <= 0) {
        throw new Error('Alpha Vantage daily data is missing a valid split coefficient')
      }
      for (const field of ['open', 'high', 'low', 'close'] as const) {
        if (parsed[field] !== undefined) parsed[field] /= splitRatio
      }
      if (parsed.volume !== undefined) parsed.volume *= splitRatio
      splitRatio *= coefficient
    }

    if (parsed.close !== undefined) bars.push({ ...parsed, timeStamp, close: parsed.close })
  }

  return bars.reverse()
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

export async function fetchAlphaVantageSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const apiKey = request.auth?.apiKey
  if (!apiKey) {
    throw new Error('Alpha Vantage API key is required')
  }

  const context = await resolveListingContext(request.listing)
  const assetClass = context.assetClass
  const interval = resolveInterval(request)
  const useAdjusted = Boolean(request.normalizationMode && request.normalizationMode !== 'raw')

  let functionName: string
  let intervalParam: string | undefined
  let symbolParam: Record<string, string> = {}

  if (assetClass === 'currency') {
    if (!context.quote) {
      throw new Error('Currency listings require a quote currency for Alpha Vantage')
    }
    const resolved = resolveFxFunction(interval)
    functionName = resolved.functionName
    intervalParam = resolved.intervalParam
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
    symbolParam = {
      symbol: context.base,
      market: context.quote,
    }
  } else {
    if (
      request.normalizationMode &&
      !resolveMarketSeriesNormalizationMode('alpha-vantage', request.normalizationMode, interval)
    ) {
      throw new Error(`Alpha Vantage does not support ${request.normalizationMode} at ${interval}`)
    }
    const symbol = resolveProviderSymbol(alphaVantageProviderConfig, context)
    const resolved = resolveEquityFunction(interval, useAdjusted)
    functionName = resolved.functionName
    intervalParam = resolved.intervalParam
    symbolParam = { symbol }
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
  if (functionName === 'TIME_SERIES_INTRADAY') {
    url.searchParams.set('adjusted', String(useAdjusted))
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

  const series = extractSeries(payload)
  if (!series || !Object.keys(series).length) {
    throw new Error('No series data returned')
  }

  const market = context.quote || 'USD'
  const timezone = Object.entries(payload['Meta Data'] ?? {}).find(([key]) =>
    key.endsWith('Time Zone')
  )?.[1]
  if (typeof timezone !== 'string' || !timezone.trim()) {
    throw new Error('Alpha Vantage response is missing its time zone')
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
  const bars = parseBars(series, functionName, request.normalizationMode, market, formatter)
  const filteredBars = filterBarsByRange(bars, request.start, request.end)

  if (!filteredBars.length) {
    throw new Error('No data returned for the requested time range')
  }

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start: filteredBars[0]?.timeStamp,
    end: filteredBars[filteredBars.length - 1]?.timeStamp,
    timezone,
    normalizationMode: request.normalizationMode,
    bars: filteredBars,
  }
}
