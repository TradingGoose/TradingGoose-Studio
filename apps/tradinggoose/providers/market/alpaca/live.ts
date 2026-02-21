import { createLogger } from '@/lib/logs/console/logger'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { intervalToMs, resolveCredentials, resolveMarket } from '@/providers/market/alpaca/series'
import type { MarketBar, MarketLiveRequest, MarketLiveSnapshot } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

const logger = createLogger('MarketProvider:Alpaca:Live')
const DEFAULT_TRADE_LIMIT = 2000
const MAX_TRADE_LIMIT = 10000

type ParsedTrade = {
  price: number
  timeMs: number
  size?: number
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return undefined
    const numeric = Number(trimmed)
    if (Number.isFinite(numeric)) {
      return numeric > 1e12 ? numeric : numeric * 1000
    }
    const parsed = Date.parse(trimmed)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function resolveFeed(request: MarketLiveRequest, market: 'stocks' | 'crypto'): string | undefined {
  if (market === 'crypto') return undefined
  return (
    (request.providerParams?.feed as string | undefined) ||
    (request.providerParams?.dataFeed as string | undefined) ||
    'iex'
  )
}

function resolveCryptoRegion(request: MarketLiveRequest): string {
  const region = String(
    request.providerParams?.region ?? request.providerParams?.cryptoRegion ?? 'us'
  ).toLowerCase()
  if (region === 'us-1' || region === 'eu-1') return region
  return 'us'
}

function resolveTradeLimit(request: MarketLiveRequest): number {
  const value = toNumber(request.providerParams?.tradeLimit ?? request.providerParams?.tickLimit)
  if (value === undefined) return DEFAULT_TRADE_LIMIT
  const rounded = Math.floor(value)
  return Math.min(Math.max(1, rounded), MAX_TRADE_LIMIT)
}

function resolveSymbolPayload(payload: unknown, symbol: string): any | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const table = payload as Record<string, any>
  return (
    table[symbol] ??
    table[symbol.toUpperCase()] ??
    table[symbol.toLowerCase()] ??
    Object.values(table)[0] ??
    null
  )
}

function parseTrade(trade: any): ParsedTrade | null {
  const price = toNumber(trade?.p ?? trade?.price)
  const timeMs = toTimestampMs(trade?.t ?? trade?.timestamp ?? trade?.time)
  if (price === undefined || timeMs === undefined) return null
  const size = toNumber(trade?.s ?? trade?.size)
  return { price, timeMs, size }
}

function mapTradeToBar(trade: ParsedTrade, timeMsOverride?: number): MarketBar {
  const timeMs = timeMsOverride ?? trade.timeMs
  return {
    timeStamp: new Date(timeMs).toISOString(),
    open: trade.price,
    high: trade.price,
    low: trade.price,
    close: trade.price,
    volume: trade.size,
  }
}

function aggregateTradesToBar(
  trades: any[],
  bucketStartMs: number,
  intervalMs: number,
  queryLimit: number,
  symbol: string
): MarketBar | null {
  const bucketEndMs = bucketStartMs + intervalMs
  let open: number | undefined
  let high = Number.NEGATIVE_INFINITY
  let low = Number.POSITIVE_INFINITY
  let close: number | undefined
  let volume = 0
  let hasVolume = false
  let points = 0

  for (const rawTrade of trades) {
    const trade = parseTrade(rawTrade)
    if (!trade) continue
    if (trade.timeMs < bucketStartMs || trade.timeMs >= bucketEndMs) continue

    if (open === undefined) open = trade.price
    high = Math.max(high, trade.price)
    low = Math.min(low, trade.price)
    close = trade.price

    if (trade.size !== undefined) {
      volume += trade.size
      hasVolume = true
    }
    points += 1
  }

  if (
    open === undefined ||
    close === undefined ||
    !Number.isFinite(high) ||
    !Number.isFinite(low)
  ) {
    return null
  }

  if (points >= queryLimit) {
    logger.warn('Alpaca live tick aggregation hit trade query limit', {
      symbol,
      bucketStart: new Date(bucketStartMs).toISOString(),
      limit: queryLimit,
    })
  }

  return {
    timeStamp: new Date(bucketStartMs).toISOString(),
    open,
    high,
    low,
    close,
    volume: hasVolume ? volume : undefined,
  }
}

async function fetchJson(url: URL, headers: Record<string, string>, context: string): Promise<any> {
  const response = await fetch(url.toString(), { headers })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(errorText || `${context} failed with status ${response.status}`)
  }
  return response.json()
}

export async function fetchAlpacaLiveSnapshot(
  request: MarketLiveRequest
): Promise<MarketLiveSnapshot> {
  const context = await resolveListingContext(request.listing)
  const market = resolveMarket(request, context.assetClass)

  if (market === 'crypto' && !context.quote) {
    throw new Error('Crypto listings require a quote currency for Alpaca symbols')
  }

  const symbol = resolveProviderSymbol(alpacaProviderConfig, context)
  const { keyId, secretKey } = resolveCredentials(request.auth)
  if (market === 'stocks' && (!keyId || !secretKey)) {
    throw new Error('Alpaca API key ID and secret key are required for stock market data')
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (keyId && secretKey) {
    headers['APCA-API-KEY-ID'] = keyId
    headers['APCA-API-SECRET-KEY'] = secretKey
  }

  const interval = request.interval || (request.providerParams?.interval as string | undefined)
  const intervalMs = intervalToMs(interval)
  const feed = resolveFeed(request, market)
  const cryptoRegion = resolveCryptoRegion(request)
  const tradeLimit = resolveTradeLimit(request)

  logger.info('Fetching Alpaca live snapshot', {
    listing: context.listing,
    symbol,
    market,
    interval,
    stream: request.stream ?? 'trades',
  })

  const latestUrl =
    market === 'crypto'
      ? new URL(`https://data.alpaca.markets/v1beta3/crypto/${cryptoRegion}/latest/trades`)
      : new URL('https://data.alpaca.markets/v2/stocks/trades/latest')
  latestUrl.searchParams.set('symbols', symbol)
  if (market === 'stocks' && feed) latestUrl.searchParams.set('feed', feed)

  const latestPayload = await fetchJson(latestUrl, headers, 'Alpaca latest trade request')
  const latestTrade = resolveSymbolPayload(latestPayload?.trades, symbol) ?? latestPayload?.trade
  const parsedLatestTrade = parseTrade(latestTrade)
  if (!parsedLatestTrade) {
    throw new Error('No valid live trade data returned')
  }

  let bar = mapTradeToBar(parsedLatestTrade)

  if (intervalMs) {
    const bucketStartMs = Math.floor(parsedLatestTrade.timeMs / intervalMs) * intervalMs
    const bucketEndMs = Math.max(bucketStartMs + intervalMs, parsedLatestTrade.timeMs + 1)
    const tradesUrl =
      market === 'crypto'
        ? new URL(`https://data.alpaca.markets/v1beta3/crypto/${cryptoRegion}/trades`)
        : new URL('https://data.alpaca.markets/v2/stocks/trades')

    tradesUrl.searchParams.set('symbols', symbol)
    tradesUrl.searchParams.set('start', new Date(bucketStartMs).toISOString())
    tradesUrl.searchParams.set('end', new Date(bucketEndMs).toISOString())
    tradesUrl.searchParams.set('sort', 'asc')
    tradesUrl.searchParams.set('limit', String(tradeLimit))
    if (market === 'stocks' && feed) tradesUrl.searchParams.set('feed', feed)

    const tradesPayload = await fetchJson(tradesUrl, headers, 'Alpaca trade range request')
    const tradeRows = resolveSymbolPayload(tradesPayload?.trades, symbol)
    const aggregatedBar = Array.isArray(tradeRows)
      ? aggregateTradesToBar(tradeRows, bucketStartMs, intervalMs, tradeLimit, symbol)
      : null
    bar = aggregatedBar ?? mapTradeToBar(parsedLatestTrade, bucketStartMs)
  }

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    interval,
    timezone: context.timeZoneName,
    stream: request.stream ?? 'trades',
    bar,
  }
}
