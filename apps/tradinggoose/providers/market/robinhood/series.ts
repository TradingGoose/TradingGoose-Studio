import { z } from 'zod'
import {
  resolveLatestSessionEndMs,
  resolveListingId,
  toDate,
} from '@/providers/market/market-hours'
import {
  callRobinhoodTool,
  invalidRequest,
  numberValue,
  resolveRobinhoodListing,
  robinhoodError,
} from '@/providers/market/robinhood/client'
import { ROBINHOOD_INTERVALS } from '@/providers/market/robinhood/config'
import { intervalToMs } from '@/providers/market/series-planner'
import { rangeToMs } from '@/providers/market/series-window'
import type { MarketBar, MarketSeries, MarketSeriesRequest } from '@/providers/market/types'

const DAY_MS = 86_400_000
const MAX_REQUESTS = 20
const BARS_PER_REQUEST = 2_000
// Output schema captured from Robinhood's tools/list:
// https://github.com/Slijeff/robinhood-rest2mcp/blob/d52abd068f98efdc6ec62b5670d04220615245a5/spec.json
const barSchema = z.object({
  begins_at: z.string().datetime({ offset: true }),
  open_price: numberValue,
  high_price: numberValue,
  low_price: numberValue,
  close_price: numberValue,
  volume: numberValue.refine((value) => value >= 0),
  interpolated: z.boolean().optional(),
})
const responseSchema = z.object({
  data: z.object({
    results: z
      .array(z.object({ symbol: z.string(), bars: z.array(barSchema.nullable()).nullable() }))
      .nullable(),
  }),
})

function normalizeRobinhoodBars(payload: unknown, symbol: string): MarketBar[] {
  const result = responseSchema.safeParse(payload)
  if (!result.success) {
    throw robinhoodError('Robinhood returned invalid historical data for the requested symbol', 502)
  }
  const rows = result.data.data.results ?? []
  if (rows.length === 0) return []
  if (rows.length !== 1 || rows[0].symbol !== symbol) {
    throw robinhoodError('Robinhood returned invalid historical data for the requested symbol', 502)
  }
  return (rows[0].bars ?? [])
    .filter((bar) => bar !== null)
    .filter((bar) => !bar.interpolated)
    .map((bar) => ({
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
  const { context, symbol } = await resolveRobinhoodListing(request.listing)
  const window = request.windows?.[0]
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
      ? 0
      : (toDate(request.start)?.getTime() ?? endMs - (rangeMs ?? 30 * DAY_MS))
  if (startMs >= endMs) invalidRequest('Robinhood start time must precede end time')
  const pageMs =
    Math.min(BARS_PER_REQUEST, barCount ? Math.max(2, barCount * 2) : BARS_PER_REQUEST) * intervalMs
  // Count windows allow the existing request budget per batch of requested bars.
  const requestLimit = MAX_REQUESTS * Math.ceil((barCount ?? BARS_PER_REQUEST) / BARS_PER_REQUEST)
  if (!barCount && Math.ceil((endMs - startMs) / pageMs) > MAX_REQUESTS) {
    invalidRequest(
      'Robinhood range is too large for this interval. Choose a coarser interval or shorter range.'
    )
  }

  const barsByTime = new Map<string, MarketBar>()
  const deadline = AbortSignal.timeout(60_000)
  let cursor = endMs
  for (let page = 0; page < requestLimit && cursor > startMs; page++) {
    // Continue through closures until the requested bars or request budget is reached.
    const span = barCount ? Math.min(BARS_PER_REQUEST * intervalMs, pageMs * 2 ** page) : pageMs
    const from = Math.max(startMs, cursor - span)
    const payload = await callRobinhoodTool(
      request.auth.accessToken,
      'get_equity_historicals',
      {
        symbols: [symbol],
        interval: upstreamInterval,
        start_time: new Date(from).toISOString(),
        end_time: new Date(cursor).toISOString(),
        bounds: session,
        adjustment_type: normalizationMode === 'raw' ? 'none' : 'split',
      },
      deadline
    )
    for (const bar of normalizeRobinhoodBars(payload, symbol)) {
      const timestamp = Date.parse(bar.timeStamp)
      if (timestamp >= from && timestamp <= cursor && !barsByTime.has(bar.timeStamp)) {
        barsByTime.set(bar.timeStamp, bar)
      }
    }
    cursor = from
    if (barCount && barsByTime.size >= barCount) break
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
