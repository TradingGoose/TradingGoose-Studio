import { createLogger } from '@/lib/logs/console/logger'
import type { ToolConfig, ToolResponse } from '@/tools/types'

type Provider = 'alpaca' | 'yahoo_finance' | 'finnhub'

export interface HistoricalDataParams {
  provider: Provider
  stock: string
  data_resolution: string
  start: string | number
  end: string | number
  alpaca_api_key_id?: string
  alpaca_api_secret_key?: string
  finnhub_api_key?: string
}

export interface HistoricalDataOutput {
  stock: string
  close: number[]
  high: number[]
  low: number[]
  open: number[]
  date: string[]
  volume: number[]
}

const logger = createLogger('HistoricalDataTool')

const normalizeProvider = (provider: string): Provider => {
  const normalized = (provider || '').toLowerCase().replace(/\s+/g, '_')
  if (normalized === 'yahoo' || normalized === 'yahoo_finance') return 'yahoo_finance'
  if (normalized === 'alpaca') return 'alpaca'
  if (normalized === 'finnhub') return 'finnhub'
  throw new Error(`Unsupported provider: ${provider}`)
}

const ensureUnixSeconds = (value: string | number, field: string): number => {
  const rawValue = typeof value === 'string' ? value.trim() : value

  if (typeof rawValue === 'number' || /^\d+(\.\d+)?$/.test(String(rawValue))) {
    const numeric = Number(rawValue)
    if (Number.isNaN(numeric)) throw new Error(`Invalid ${field} value`)
    return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric)
  }

  const parsed = Date.parse(String(rawValue))
  if (Number.isNaN(parsed)) {
    throw new Error(`Invalid ${field} value: ${String(value)}`)
  }
  return Math.floor(parsed / 1000)
}

const ensureIsoString = (value: string | number, field: string): string => {
  const rawValue = typeof value === 'string' ? value.trim() : value
  const date =
    typeof rawValue === 'number' || /^\d+(\.\d+)?$/.test(String(rawValue))
      ? new Date(ensureUnixSeconds(rawValue as any, field) * 1000)
      : new Date(rawValue)

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} value: ${String(value)}`)
  }

  return date.toISOString()
}

const buildUnifiedFromArrays = (
  symbol: string,
  open: Array<number | undefined>,
  high: Array<number | undefined>,
  low: Array<number | undefined>,
  close: Array<number | undefined>,
  volume: Array<number | undefined>,
  timestamps: Array<string | number | undefined>
): HistoricalDataOutput => {
  const lengths = [
    open?.length ?? 0,
    high?.length ?? 0,
    low?.length ?? 0,
    close?.length ?? 0,
    volume?.length ?? 0,
    timestamps?.length ?? 0,
  ]
  const length = lengths.length ? Math.min(...lengths) : 0

  if (!length) {
    throw new Error('No data returned for the requested time range')
  }

  const toNumberArray = (values: Array<number | undefined>) =>
    values.slice(0, length).map((value) => Number(value ?? 0))

  const openSeries = toNumberArray(open || [])
  const highSeries = toNumberArray(high || [])
  const lowSeries = toNumberArray(low || [])
  const closeSeries = toNumberArray(close || [])
  const volumeSeries = toNumberArray(volume || [])
  const dateSeries = timestamps.slice(0, length).map((value, index) => {
    try {
      return ensureIsoString(value ?? timestamps[index] ?? Date.now(), 'timestamp')
    } catch (error) {
      logger.warn('Unable to parse timestamp, falling back to current time', { error })
      return new Date().toISOString()
    }
  })

  return {
    stock: symbol,
    close: closeSeries,
    high: highSeries,
    low: lowSeries,
    open: openSeries,
    date: dateSeries,
    volume: volumeSeries,
  }
}

const normalizeAlpaca = (rawData: any, params: HistoricalDataParams): HistoricalDataOutput => {
  const symbol = (params.stock || '').toUpperCase()
  const bars = rawData?.bars?.[symbol] || rawData?.bars?.[params.stock] || Object.values(rawData?.bars || {})[0] || []

  if (!Array.isArray(bars) || !bars.length) {
    throw new Error('Alpaca returned no bars for the requested symbol')
  }

  const open = bars.map((bar: any) => bar.o ?? bar.open)
  const high = bars.map((bar: any) => bar.h ?? bar.high)
  const low = bars.map((bar: any) => bar.l ?? bar.low)
  const close = bars.map((bar: any) => bar.c ?? bar.close)
  const volume = bars.map((bar: any) => bar.v ?? bar.volume)
  const timestamps = bars.map((bar: any) => bar.t ?? bar.time ?? bar.timestamp)

  return buildUnifiedFromArrays(symbol, open, high, low, close, volume, timestamps)
}

const normalizeYahooFinance = (rawData: any, params: HistoricalDataParams): HistoricalDataOutput => {
  const chartResult = rawData?.chart?.result?.[0]

  if (chartResult) {
    const quote = chartResult.indicators?.quote?.[0] || {}
    const timestamps = chartResult.timestamp || []
    const symbol = chartResult.meta?.symbol || params.stock

    return buildUnifiedFromArrays(
      symbol,
      quote.open || [],
      quote.high || [],
      quote.low || [],
      quote.close || [],
      quote.volume || [],
      timestamps
    )
  }

  if (Array.isArray(rawData?.quotes)) {
    const symbol = rawData?.meta?.symbol || params.stock
    const quotes = rawData.quotes
    return buildUnifiedFromArrays(
      symbol,
      quotes.map((entry: any) => entry.open),
      quotes.map((entry: any) => entry.high),
      quotes.map((entry: any) => entry.low),
      quotes.map((entry: any) => entry.close ?? entry.adjclose),
      quotes.map((entry: any) => entry.volume),
      quotes.map((entry: any) => entry.date)
    )
  }

  throw new Error('Unexpected Yahoo Finance response format')
}

const normalizeFinnhub = (rawData: any, params: HistoricalDataParams): HistoricalDataOutput => {
  if (rawData?.s && rawData.s !== 'ok') {
    throw new Error(`Finnhub request failed with status: ${rawData.s}`)
  }

  const timestamps = rawData?.t || []
  if (!Array.isArray(timestamps) || !timestamps.length) {
    throw new Error('Finnhub returned no candles for the requested symbol')
  }

  return buildUnifiedFromArrays(
    params.stock,
    rawData?.o || [],
    rawData?.h || [],
    rawData?.l || [],
    rawData?.c || [],
    rawData?.v || [],
    timestamps
  )
}

const transformProviderResponse = (provider: Provider, rawData: any, params: HistoricalDataParams) => {
  switch (provider) {
    case 'alpaca':
      return normalizeAlpaca(rawData, params)
    case 'yahoo_finance':
      return normalizeYahooFinance(rawData, params)
    case 'finnhub':
      return normalizeFinnhub(rawData, params)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

export const historicalDataTool: ToolConfig<HistoricalDataParams, ToolResponse> = {
  id: 'historical_data_fetch',
  name: 'Historical Data Fetch',
  description: 'Fetch and normalize historical market data from Alpaca, Yahoo Finance, or Finnhub.',
  version: '1.0.0',
  params: {
    provider: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Data provider to use: alpaca, yahoo_finance, or finnhub.',
    },
    stock: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Ticker symbol to fetch data for.',
    },
    data_resolution: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Timeframe/resolution for the data. For Alpaca use values like 1Min/1Day, Yahoo Finance use intervals like 1d/1wk/1mo, Finnhub supports 1,5,15,30,60,D,W,M.',
    },
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start of the interval (ISO date string or UNIX timestamp).',
    },
    end: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End of the interval (ISO date string or UNIX timestamp).',
    },
    alpaca_api_key_id: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Alpaca API key ID (falls back to ALPACA_API_KEY_ID env var).',
    },
    alpaca_api_secret_key: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Alpaca API secret key (falls back to ALPACA_API_SECRET_KEY env var).',
    },
    finnhub_api_key: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Finnhub API key (falls back to FINNHUB_API_KEY env var).',
    },
  },
  request: {
    method: 'GET',
    url: (params: HistoricalDataParams) => {
      const provider = normalizeProvider(params.provider)
      const stock = encodeURIComponent(params.stock.trim())
      const startUnix = ensureUnixSeconds(params.start, 'start')
      const endUnix = ensureUnixSeconds(params.end, 'end')

      if (provider === 'alpaca') {
        const url = new URL('https://data.alpaca.markets/v2/stocks/bars')
        url.searchParams.set('symbols', params.stock.trim())
        url.searchParams.set('timeframe', params.data_resolution)
        url.searchParams.set('start', ensureIsoString(params.start, 'start'))
        url.searchParams.set('end', ensureIsoString(params.end, 'end'))
        return url.toString()
      }

      if (provider === 'yahoo_finance') {
        const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${stock}`)
        url.searchParams.set('period1', String(startUnix))
        url.searchParams.set('period2', String(endUnix))
        url.searchParams.set('interval', params.data_resolution)
        return url.toString()
      }

      if (provider === 'finnhub') {
        const url = new URL('https://finnhub.io/api/v1/candle')
        url.searchParams.set('symbol', params.stock.trim())
        url.searchParams.set('resolution', params.data_resolution)
        url.searchParams.set('from', String(startUnix))
        url.searchParams.set('to', String(endUnix))
        return url.toString()
      }

      throw new Error(`Unsupported provider: ${params.provider}`)
    },
    headers: (params: HistoricalDataParams) => {
      const provider = normalizeProvider(params.provider)

      if (provider === 'alpaca') {
        const keyId = params.alpaca_api_key_id || process.env.ALPACA_API_KEY_ID
        const secret = params.alpaca_api_secret_key || process.env.ALPACA_API_SECRET_KEY

        if (!keyId || !secret) {
          throw new Error('Alpaca API key ID and secret key are required')
        }

        return {
          'APCA-API-KEY-ID': keyId,
          'APCA-API-SECRET-KEY': secret,
        }
      }

      if (provider === 'finnhub') {
        const apiKey = params.finnhub_api_key || process.env.FINNHUB_API_KEY
        if (!apiKey) {
          throw new Error('Finnhub API key is required')
        }
        return { 'X-Finnhub-Token': apiKey }
      }

      return { Accept: 'application/json' }
    },
  },
  transformResponse: async (response: Response) => {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const errorMessage =
        typeof data === 'object' && data !== null && 'message' in data
          ? (data as any).message
          : response.statusText
      return {
        success: false,
        output: data || {},
        error: errorMessage,
      }
    }

    return {
      success: true,
      output: data,
    }
  },
  postProcess: async (result, params: HistoricalDataParams): Promise<ToolResponse> => {
    if (!result.success) {
      return result
    }

    try {
      const provider = normalizeProvider(params.provider)
      const normalized = transformProviderResponse(provider, result.output, params)
      return {
        success: true,
        output: normalized,
      }
    } catch (error: any) {
      logger.error('Error normalizing historical data', {
        provider: params.provider,
        error: error?.message || error,
      })
      return {
        success: false,
        output: result.output,
        error: error?.message || 'Failed to normalize historical data',
      }
    }
  },
  outputs: {
    stock: { type: 'string', description: 'Ticker symbol for the returned series' },
    open: { type: 'array', description: 'Open prices for each bar' },
    high: { type: 'array', description: 'High prices for each bar' },
    low: { type: 'array', description: 'Low prices for each bar' },
    close: { type: 'array', description: 'Close prices for each bar' },
    volume: { type: 'array', description: 'Volume for each bar' },
    date: { type: 'array', description: 'ISO timestamps for each bar' },
  },
}
