import { createLogger } from '@/lib/logs/console/logger'
import type {
  MarketBar,
  MarketSeries,
  MarketSeriesRequest,
  MarketInterval,
} from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'

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
const FINNHUB_RESOLUTIONS = new Set(['1', '5', '15', '30', '60', 'D', 'W', 'M'])

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

function resolveResolution(interval?: string): string {
  const fallback = 'D'
  if (!interval) return fallback
  const mapped = FINNHUB_RESOLUTION_MAP[interval as MarketInterval]
  if (mapped) return mapped
  if (FINNHUB_RESOLUTIONS.has(interval)) return interval
  return fallback
}

type FinnhubEndpoint = 'stock' | 'forex' | 'crypto'

function resolveTimeRange(
  request: MarketSeriesRequest
): { from?: number; to?: number } {
  const to = toUnixSeconds(request.end)
  const from = toUnixSeconds(request.start)

  if (from != null && to != null && from >= to) {
    return { from, to: undefined }
  }

  return { from, to }
}

function resolveEndpoint(
  request: MarketSeriesRequest,
  assetClass?: string
): FinnhubEndpoint {
  const override = request.providerParams?.endpoint as string | undefined
  if (override === 'forex' || override === 'crypto' || override === 'stock') {
    return override
  }

  if (assetClass === 'currency') return 'forex'
  if (assetClass === 'crypto') return 'crypto'
  return 'stock'
}

function resolveSeriesEndpointUrl(
  endpoint: FinnhubEndpoint,
  assetClass?: string
): string {
  const mappedAssetClass =
    endpoint === 'forex'
      ? 'currency'
      : endpoint === 'crypto'
        ? 'crypto'
        : (assetClass as string | undefined) || 'stock'

  return (
    finnhubProviderConfig.api_endpoints?.[
      mappedAssetClass as keyof typeof finnhubProviderConfig.api_endpoints
    ] ||
    finnhubProviderConfig.api_endpoints?.default
  )
}

export async function fetchFinnhubSeries(
  request: MarketSeriesRequest
): Promise<MarketSeries> {
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
  const interval = request.interval || (request.providerParams?.interval as string | undefined)
  const resolution = resolveResolution(interval)

  const apiKey = request.auth?.apiKey || process.env.FINNHUB_API_KEY

  if (!apiKey) {
    throw new Error('Finnhub API key is required')
  }

  const seriesEndpoint = resolveSeriesEndpointUrl(endpoint, context.assetClass)
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

  const response = await fetch(url.toString(), {
    headers: {
      'X-Finnhub-Token': apiKey,
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `Finnhub request failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    c?: number[]
    h?: number[]
    l?: number[]
    o?: number[]
    t?: number[]
    v?: number[]
    s?: string
    error?: string
  }

  if (!payload || payload.s !== 'ok') {
    throw new Error(payload?.error || 'No candle data returned')
  }

  const times = payload.t || []
  const bars: MarketBar[] = []

  for (let i = 0; i < times.length; i += 1) {
    const close = payload.c?.[i]
    if (close == null) continue

    bars.push({
      timeStamp: new Date(times[i] * 1000).toISOString(),
      open: payload.o?.[i],
      high: payload.h?.[i],
      low: payload.l?.[i],
      close,
      volume: payload.v?.[i],
    })
  }

  const start = bars[0]?.timeStamp ?? toIsoString(request.start)
  const end = bars.length ? bars[bars.length - 1]?.timeStamp : toIsoString(request.end)

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
