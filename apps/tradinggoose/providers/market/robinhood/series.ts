import { z } from 'zod'
import { callRobinhoodTool } from '@/lib/robinhood/client'
import { MarketProviderError } from '@/providers/market/errors'
import {
  resolveLatestSessionEndMs,
  resolveListingId,
  toDate,
} from '@/providers/market/market-hours'
import { ROBINHOOD_INTERVALS, robinhoodProviderConfig } from '@/providers/market/robinhood/config'
import { intervalToMs } from '@/providers/market/series-planner'
import { normalizeSeriesWindows, rangeToMs } from '@/providers/market/series-window'
import type { MarketBar, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'

const DAY_MS = 86_400_000
const MAX_REQUESTS = 20
const BARS_PER_REQUEST = 2_000
const numberValue = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(Number)
  .pipe(z.number().finite())
// Observed MCP envelope: data.results[].{symbol,bars}. Numeric prices are strings.
// Reference: github.com/abiemann/RobinhoodEquityTradingAgent/blob/main/evaluate_candidates.py
const responseSchema = z.object({
  data: z.object({
    results: z.array(
      z.object({
        symbol: z.string(),
        bars: z.array(
          z.object({
            begins_at: z.string().datetime({ offset: true }),
            open_price: numberValue,
            high_price: numberValue,
            low_price: numberValue,
            close_price: numberValue,
            volume: numberValue.refine((value) => value >= 0),
          })
        ),
      })
    ),
  }),
})

function invalidRequest(message: string): never {
  throw new MarketProviderError({
    code: 'INVALID REQUEST',
    message,
    provider: 'robinhood',
    status: 400,
  })
}

function normalizeRobinhoodBars(payload: unknown, symbol: string): MarketBar[] {
  const result = responseSchema.safeParse(payload)
  const rows = result.success ? result.data.data.results.filter((row) => row.symbol === symbol) : []
  if (rows.length !== 1) {
    throw new MarketProviderError({
      code: 'PROVIDER ERROR',
      provider: 'robinhood',
      status: 502,
      message: 'Robinhood returned invalid historical data for the requested symbol',
    })
  }
  return rows[0].bars.map((bar) => ({
    timeStamp: new Date(bar.begins_at).toISOString(),
    open: bar.open_price,
    high: bar.high_price,
    low: bar.low_price,
    close: bar.close_price,
    volume: bar.volume,
  }))
}

export async function fetchRobinhoodSeries(request: MarketSeriesRequest): Promise<MarketSeries> {
  if (!request.auth?.accessToken) invalidRequest('Robinhood connection is required')
  const interval = request.interval ?? '1d'
  const upstreamInterval = ROBINHOOD_INTERVALS[interval as keyof typeof ROBINHOOD_INTERVALS]
  const intervalMs = intervalToMs(interval)
  if (!upstreamInterval || !intervalMs) invalidRequest('Unsupported Robinhood interval')
  const normalizationMode = request.normalizationMode ?? 'split_adjusted'
  if (normalizationMode !== 'raw' && normalizationMode !== 'split_adjusted') {
    invalidRequest('Unsupported Robinhood price normalization')
  }
  const context = await resolveListingContext(request.listing)
  if (
    !context.assetClass ||
    !['stock', 'etf'].includes(context.assetClass) ||
    (context.quote && context.quote !== 'USD') ||
    (context.countryCode && context.countryCode !== 'US')
  )
    invalidRequest('Robinhood market data supports US stocks and ETFs quoted in USD')
  const symbol = resolveProviderSymbol(robinhoodProviderConfig, context).trim().toUpperCase()
  if (!symbol) invalidRequest('Robinhood requires a stock symbol')
  const window = normalizeSeriesWindows(request.windows ?? [], ['bars', 'range', 'absolute'])[0]
  const barCount =
    window?.mode === 'bars'
      ? window.barCount
      : !window && request.start === undefined
        ? 200
        : undefined
  if (
    barCount !== undefined &&
    (!Number.isSafeInteger(barCount) || barCount < 1 || barCount > 10_000)
  ) {
    invalidRequest('Robinhood bar count must be between 1 and 10000')
  }
  const session = request.providerParams?.marketSession === 'extended' ? 'extended' : 'regular'
  let endMs = toDate(request.end)?.getTime() ?? Date.now()
  if (barCount !== undefined) {
    const listingId = resolveListingId(request.listing)
    if (listingId) {
      endMs =
        (await resolveLatestSessionEndMs(listingId, request.listing.listing_type, session)) ?? endMs
    }
  }
  const rangeMs = window?.mode === 'range' ? rangeToMs(window.range) : null
  const startMs =
    barCount !== undefined
      ? Math.max(0, endMs - Math.max(7 * DAY_MS, barCount * intervalMs * 6))
      : (toDate(request.start)?.getTime() ?? endMs - (rangeMs ?? 30 * DAY_MS))
  if (startMs >= endMs) invalidRequest('Robinhood start time must precede end time')
  const pageMs =
    Math.min(BARS_PER_REQUEST, barCount ? Math.max(2, barCount * 2) : BARS_PER_REQUEST) * intervalMs
  if (!barCount && Math.ceil((endMs - startMs) / pageMs) > MAX_REQUESTS) {
    invalidRequest(
      'Robinhood range is too large for this interval. Choose a coarser interval or shorter range.'
    )
  }

  const barsByTime = new Map<string, MarketBar>()
  let cursor = endMs
  for (let page = 0; page < MAX_REQUESTS && cursor > startMs; page++) {
    // Expand empty lookbacks across closures; bound each upstream call's bar count.
    const span = barCount ? Math.min(BARS_PER_REQUEST * intervalMs, pageMs * 2 ** page) : pageMs
    const from = Math.max(startMs, cursor - span)
    const payload = await callRobinhoodTool(request.auth.accessToken, 'get_equity_historicals', {
      symbols: [symbol],
      interval: upstreamInterval,
      start_time: new Date(from).toISOString(),
      end_time: new Date(cursor).toISOString(),
      bounds: session,
      adjustment_type: normalizationMode === 'raw' ? 'none' : 'split',
    })
    for (const bar of normalizeRobinhoodBars(payload, symbol)) {
      const timestamp = Date.parse(bar.timeStamp)
      if (timestamp >= from && timestamp <= cursor && !barsByTime.has(bar.timeStamp)) {
        barsByTime.set(bar.timeStamp, bar)
      }
    }
    cursor = from
    if (barCount && barsByTime.size >= barCount) break
  }
  if (cursor > startMs && (!barCount || barsByTime.size < barCount)) {
    invalidRequest(
      'Robinhood history exceeded the request limit. Choose a coarser interval or shorter range.'
    )
  }
  const ordered = [...barsByTime.values()].sort((a, b) => a.timeStamp.localeCompare(b.timeStamp))
  const bars = barCount ? ordered.slice(-barCount) : ordered
  return {
    listing: request.listing,
    listingBase: context.base,
    listingQuote: context.quote,
    marketCode: context.marketCode,
    timezone: context.timeZoneName,
    normalizationMode,
    start: bars[0]?.timeStamp,
    end: bars.at(-1)?.timeStamp,
    bars,
  }
}
