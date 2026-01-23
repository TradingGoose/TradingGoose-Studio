import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import type {
  MarketBar,
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
  MarketSeriesWindow,
} from '@/providers/market/types'

const DAY_MS = 24 * 60 * 60 * 1000

const INTERVAL_MS: Record<MarketInterval, number> = {
  '1m': 60 * 1000,
  '2m': 2 * 60 * 1000,
  '3m': 3 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '45m': 45 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '2h': 2 * 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * DAY_MS,
  '2w': 14 * DAY_MS,
  '1mo': 30 * DAY_MS,
  '3mo': 90 * DAY_MS,
  '6mo': 180 * DAY_MS,
  '12mo': 365 * DAY_MS,
}

type PlannedSeriesWindow = {
  mode: 'bars' | 'range'
  barCount?: number
  rangeMs?: number
}

const intervalToMs = (interval?: string): number | null => {
  if (!interval) return null
  if (interval in INTERVAL_MS) {
    return INTERVAL_MS[interval as MarketInterval]
  }
  return null
}

const rangeToMs = (range?: MarketSeriesWindow['range']): number | null => {
  if (!range) return null
  const value = Number(range.value)
  if (!Number.isFinite(value) || value <= 0) return null
  switch (range.unit) {
    case 'day':
      return value * DAY_MS
    case 'week':
      return value * 7 * DAY_MS
    case 'month':
      return value * 30 * DAY_MS
    case 'year':
      return value * 365 * DAY_MS
    default:
      return null
  }
}

const rangeParamFromMs = (rangeMs?: number | null): string | null => {
  if (!rangeMs || !Number.isFinite(rangeMs) || rangeMs <= 0) return null
  const dayCount = Math.ceil(rangeMs / DAY_MS)
  if (!Number.isFinite(dayCount) || dayCount <= 0) return null
  if (dayCount % 365 === 0) return `${dayCount / 365}y`
  if (dayCount % 30 === 0) return `${dayCount / 30}mo`
  return `${dayCount}d`
}

const resolveRetention = (providerId: string, interval?: string) => {
  const capabilities = getMarketSeriesCapabilities(providerId)
  const retention = capabilities?.retention
  if (!retention) return undefined
  if (interval && retention.byInterval?.[interval as MarketInterval]) {
    return retention.byInterval[interval as MarketInterval]
  }
  return retention.default
}

const normalizeWindow = (
  window?: MarketSeriesWindow,
  intervalMs?: number | null,
  retention?: { maxRangeDays?: number; maxBars?: number }
): PlannedSeriesWindow | null => {
  if (!window) return null

  if (window.mode === 'bars') {
    const rawBars = Number(window.barCount)
    if (!Number.isFinite(rawBars) || rawBars <= 0) return null
    let barCount = Math.floor(rawBars)

    if (retention?.maxBars && retention.maxBars > 0) {
      barCount = Math.min(barCount, retention.maxBars)
    }

    if (intervalMs && retention?.maxRangeDays && retention.maxRangeDays > 0) {
      const maxBarsFromRange = Math.floor((retention.maxRangeDays * DAY_MS) / intervalMs)
      if (maxBarsFromRange > 0) {
        barCount = Math.min(barCount, maxBarsFromRange)
      }
    }

    return barCount > 0 ? { mode: 'bars', barCount } : null
  }

  if (window.mode === 'range') {
    let rangeMs = rangeToMs(window.range)
    if (!rangeMs || rangeMs <= 0) return null

    if (retention?.maxRangeDays && retention.maxRangeDays > 0) {
      const maxRangeMs = retention.maxRangeDays * DAY_MS
      rangeMs = Math.min(rangeMs, maxRangeMs)
    }

    if (intervalMs && retention?.maxBars && retention.maxBars > 0) {
      const maxRangeByBars = retention.maxBars * intervalMs
      rangeMs = Math.min(rangeMs, maxRangeByBars)
    }

    return rangeMs > 0 ? { mode: 'range', rangeMs } : null
  }

  return null
}

const normalizeBars = (bars: MarketBar[]) => {
  const entries = bars
    .map((bar) => ({
      bar,
      ts: Date.parse(bar.timeStamp),
    }))
    .filter((entry) => Number.isFinite(entry.ts))
    .sort((a, b) => a.ts - b.ts)

  return entries
}

export const planMarketSeriesRequest = (
  providerId: string,
  request: MarketSeriesRequest
): { request: MarketSeriesRequest; window: PlannedSeriesWindow | null } => {
  const interval =
    request.interval || (request.providerParams?.interval as string | undefined)
  const intervalMs = intervalToMs(interval)
  const retention = resolveRetention(providerId, interval)
  const window = normalizeWindow(request.window, intervalMs, retention)

  if (!window) {
    return { request, window: null }
  }

  const planned: MarketSeriesRequest = {
    ...request,
    providerParams: request.providerParams ? { ...request.providerParams } : undefined,
  }
  if (window.mode === 'bars' || window.mode === 'range') {
    delete planned.start
    delete planned.end
  }

  const rangeParam =
    window.mode === 'range' ? rangeParamFromMs(window.rangeMs) : null
  if (rangeParam && planned.providerParams?.range == null) {
    planned.providerParams = {
      ...(planned.providerParams ?? {}),
      range: rangeParam,
    }
  }

  const barCount =
    window.mode === 'bars'
      ? window.barCount ?? null
      : window.rangeMs && intervalMs
        ? Math.ceil(window.rangeMs / intervalMs)
        : null
  if (barCount && planned.providerParams?.limit == null) {
    planned.providerParams = {
      ...(planned.providerParams ?? {}),
      limit: barCount,
    }
  }

  return { request: planned, window }
}

export const applySeriesWindow = (
  series: MarketSeries,
  window: PlannedSeriesWindow | null
): MarketSeries => {
  if (!window) return series
  const bars = Array.isArray(series.bars) ? series.bars : []
  if (bars.length === 0) return series

  const entries = normalizeBars(bars)
  if (entries.length === 0) return { ...series, bars: [] }

  const endMs = entries[entries.length - 1]?.ts
  if (!Number.isFinite(endMs)) {
    return { ...series, bars: entries.map((entry) => entry.bar) }
  }

  let filtered = entries

  if (window.mode === 'range' && window.rangeMs) {
    const startMs = endMs - window.rangeMs
    filtered = entries.filter((entry) => entry.ts >= startMs)
  }

  if (window.mode === 'bars' && window.barCount && filtered.length > window.barCount) {
    filtered = filtered.slice(filtered.length - window.barCount)
  }

  const slicedBars = filtered.map((entry) => entry.bar)
  const nextStart = slicedBars[0]?.timeStamp ?? series.start
  const nextEnd = slicedBars[slicedBars.length - 1]?.timeStamp ?? series.end

  return {
    ...series,
    bars: slicedBars,
    start: nextStart,
    end: nextEnd,
  }
}
