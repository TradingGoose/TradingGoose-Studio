import { createLogger } from '@/lib/logs/console/logger'
import type { MarketBar, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'

const logger = createLogger('MarketProvider:Finnhub')

const RESOLUTION_WHITELIST = new Set(
  finnhubProviderConfig.capabilities?.series?.intervals ?? []
)

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
  if (!RESOLUTION_WHITELIST.size) return interval
  return RESOLUTION_WHITELIST.has(interval) ? interval : fallback
}

type FinnhubEndpoint = 'stock' | 'forex' | 'crypto'

function resolveTimeRange(request: MarketSeriesRequest): { from: number; to: number } {
  const nowSeconds = Math.floor(Date.now() / 1000)

  const to = toUnixSeconds(request.end) ?? nowSeconds
  const explicitFrom = toUnixSeconds(request.start)
  const from = explicitFrom ?? nowSeconds - 30 * 24 * 60 * 60

  if (from >= to) {
    return { from: nowSeconds - 30 * 24 * 60 * 60, to: nowSeconds }
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

export async function fetchFinnhubSeries(
  request: MarketSeriesRequest
): Promise<MarketSeries> {
  if (!request.listingId) {
    throw new Error('listingId is required')
  }

  const context = await resolveListingContext(request.listingId)
  const endpoint = resolveEndpoint(request, context.assetClass)

  if ((endpoint === 'forex' || context.assetClass === 'currency') && !context.quote) {
    throw new Error('Currency listings require a quote currency for Finnhub forex symbols')
  }

  if ((endpoint === 'crypto' || context.assetClass === 'crypto') && !context.quote) {
    throw new Error('Crypto listings require a quote currency for Finnhub crypto symbols')
  }

  const symbol = resolveProviderSymbol(finnhubProviderConfig, context)
  const { from, to } = resolveTimeRange(request)
  const interval = request.interval || (request.providerParams?.interval as string | undefined)
  const resolution = resolveResolution(interval)

  const apiKey =
    (request.providerParams?.apiKey as string | undefined) || process.env.FINNHUB_API_KEY

  if (!apiKey) {
    throw new Error('Finnhub API key is required')
  }

  const url = new URL(`https://finnhub.io/api/v1/${endpoint}/candle`)
  url.searchParams.set('symbol', symbol)
  url.searchParams.set('resolution', resolution)
  url.searchParams.set('from', String(from))
  url.searchParams.set('to', String(to))

  logger.info('Fetching Finnhub candles', {
    listingId: request.listingId,
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
    listingId: request.listingId,
    listingBase: context.base,
    listingQuote: context.quote,
    primaryMicCode: context.micCode ?? context.primaryMicCode,
    start,
    end,
    timezone: context.timeZoneName,
    normalizationMode: request.normalizationMode,
    bars,
  }
}
