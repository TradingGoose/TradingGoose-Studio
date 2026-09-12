import { createLogger } from '@/lib/logs/console/logger'
import { ibkrMarketProviderConfig } from '@/providers/market/ibkr/config'
import type { MarketBar, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrApiUrl } from '@/providers/trading/ibkr/client'
import { ensureIbkrSession } from '@/providers/trading/ibkr/session'
import { resolveIbkrConidFromApi } from '@/providers/trading/ibkr/symbols'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'

const logger = createLogger('MarketProvider:IBKR')

/**
 * IBKR bar sizes, not generic resolution strings. Valid values are
 * 1min..30min, 1h..8h, 1d, 1w, 1m -- note `1m` means one MONTH here, while one
 * minute is `1min`.
 */
const IBKR_BAR_MAP: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '30m': '30min',
  '1h': '1h',
  '1d': '1d',
  '1w': '1w',
  '1mo': '1m',
}

/** Largest lookback IBKR will serve for a given bar size, in days. */
const MAX_PERIOD_DAYS: Record<string, number> = {
  '1min': 1,
  '5min': 7,
  '15min': 14,
  '30min': 30,
  '1h': 30,
  '1d': 365,
  '1w': 365 * 5,
  '1m': 365 * 20,
}

const resolveBar = (interval?: string): string => (interval && IBKR_BAR_MAP[interval]) || '1d'

const toMillis = (value?: string | number): number | undefined => {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  const parsed = Date.parse(String(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

const toIsoString = (millis?: number): string | undefined => {
  if (millis === undefined) return undefined
  const date = new Date(millis)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * IBKR takes a duration string, not a from/to window. We convert the requested
 * range into the smallest period that covers it, clamped to what the chosen bar
 * size actually supports so the request is not rejected outright.
 */
const buildPeriod = (startMs: number, endMs: number, bar: string): string => {
  const days = Math.max(1, Math.ceil((endMs - startMs) / 86_400_000))
  const capped = Math.min(days, MAX_PERIOD_DAYS[bar] ?? 365)
  if (capped <= 30) return `${capped}d`
  if (capped <= 365) return `${Math.ceil(capped / 30)}m`
  return `${Math.ceil(capped / 365)}y`
}

/** IBKR wants startTime as YYYYMMDD-HH:mm:ss, in UTC. */
const toIbkrStartTime = (millis: number): string => {
  const d = new Date(millis)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `-${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
  )
}

interface IbkrHistoryBar {
  t?: number
  o?: number
  h?: number
  l?: number
  c?: number
  v?: number
}

/** The endpoint returns an envelope; bars live under `data`. */
interface IbkrHistoryResponse {
  data?: IbkrHistoryBar[]
  priceFactor?: number
  barLength?: number
  symbol?: string
  text?: string
  error?: string
}

export async function fetchIbkrSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  const context = await resolveListingContext(request.listing)
  const symbol = resolveProviderSymbol(ibkrMarketProviderConfig, context)
  const bar = resolveBar(request.interval)

  const endMs = toMillis(request.end) ?? Date.now()
  const startMs = toMillis(request.start) ?? endMs - 30 * 86_400_000
  const period = buildPeriod(startMs, endMs, bar)

  const accessToken = request.auth?.accessToken
  await ensureIbkrSession({ accessToken })

  // The history endpoint is conid-keyed; a symbol alone resolves to nothing.
  const { conid } = await resolveIbkrConidFromApi({
    symbol,
    assetClass: context.assetClass,
    accessToken,
  })

  const params = new URLSearchParams({
    conid: String(conid),
    period,
    bar,
    outsideRth: 'false',
  })
  // Only pin startTime when the caller asked for a window ending in the past;
  // otherwise let IBKR anchor the period to now.
  if (endMs < Date.now() - 60_000) {
    params.set('startTime', toIbkrStartTime(endMs))
  }

  const url = `${buildIbkrApiUrl('/iserver/marketdata/history')}?${params.toString()}`

  logger.info('Fetching IBKR market series', { symbol, conid, bar, period })

  const response = await fetchBrokerJson<IbkrHistoryResponse>({
    providerId: 'ibkr',
    url,
    init: { method: 'GET', headers: buildIbkrAuthHeaders({ accessToken }) },
  })

  if (response?.error) {
    throw new Error(`IBKR market data error for ${symbol}: ${response.error}`)
  }

  // IBKR scales prices for some contracts; dividing is required for
  // correctness and its absence is silent rather than an error.
  const priceFactor =
    typeof response?.priceFactor === 'number' && response.priceFactor > 0
      ? response.priceFactor
      : 1
  const scale = (value?: number): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value / priceFactor : undefined

  const bars: MarketBar[] = (response?.data ?? [])
    .filter((entry): entry is IbkrHistoryBar => Boolean(entry) && typeof entry === 'object')
    // Drop bars with no usable close rather than defaulting them to 0, which
    // would silently poison every downstream indicator.
    .filter((entry) => typeof entry.c === 'number' && Number.isFinite(entry.c))
    .map((entry) => ({
      timeStamp: toIsoString(toMillis(entry.t)) ?? new Date().toISOString(),
      open: scale(entry.o),
      high: scale(entry.h),
      low: scale(entry.l),
      close: scale(entry.c) as number,
      volume: typeof entry.v === 'number' ? entry.v : undefined,
    }))
    .sort((a, b) => Date.parse(a.timeStamp) - Date.parse(b.timeStamp))

  if (bars.length === 0) {
    logger.warn('IBKR returned no bars', { symbol, conid, bar, period, text: response?.text })
  }

  return {
    listing: context.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    start: toIsoString(startMs),
    end: toIsoString(endMs),
    timezone: context.timeZoneName,
    normalizationMode: 'raw',
    bars,
  }
}
