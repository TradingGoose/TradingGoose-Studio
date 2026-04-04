import { getMarketSeriesCapabilities } from '@/providers/market/providers'
import { normalizeSeriesWindow, rangeToMs } from '@/providers/market/series-window'
import type {
  MarketBar,
  MarketInterval,
  MarketSeries,
  MarketSeriesRequest,
  MarketSeriesWindow,
  MarketSeriesWindowMode,
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

type PlannedSeriesWindow =
  | { mode: 'bars'; barCount: number }
  | { mode: 'range'; rangeMs: number }
  | { mode: 'absolute'; startMs: number; endMs: number }

const intervalToMs = (interval?: string): number | null => {
  if (!interval) return null
  if (interval in INTERVAL_MS) {
    return INTERVAL_MS[interval as MarketInterval]
  }
  return null
}

const rangeParamFromMs = (rangeMs?: number | null): string | null => {
  if (!rangeMs || !Number.isFinite(rangeMs) || rangeMs <= 0) return null
  const dayCount = Math.ceil(rangeMs / DAY_MS)
  if (!Number.isFinite(dayCount) || dayCount <= 0) return null
  if (dayCount % 365 === 0) return `${dayCount / 365}y`
  if (dayCount % 30 === 0) return `${dayCount / 30}mo`
  return `${dayCount}d`
}

const toEpochMs = (value?: string | number): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
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

  if (window.mode === 'absolute') {
    const startMs = toEpochMs(window.start)
    const endMs = toEpochMs(window.end) ?? Date.now()
    if (startMs == null || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
    if (startMs >= endMs) return null

    let resolvedStart: number = startMs
    let resolvedEnd = endMs

    if (retention?.maxRangeDays && retention.maxRangeDays > 0) {
      const maxRangeMs = retention.maxRangeDays * DAY_MS
      if (resolvedEnd - resolvedStart > maxRangeMs) {
        resolvedStart = resolvedEnd - maxRangeMs
      }
    }

    if (intervalMs && retention?.maxBars && retention.maxBars > 0) {
      const maxRangeByBars = retention.maxBars * intervalMs
      if (resolvedEnd - resolvedStart > maxRangeByBars) {
        resolvedStart = resolvedEnd - maxRangeByBars
      }
    }

    if (resolvedStart >= resolvedEnd) return null
    return { mode: 'absolute', startMs: resolvedStart, endMs: resolvedEnd }
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
): {
  request: MarketSeriesRequest
  window: PlannedSeriesWindow | null
  mode: MarketSeriesWindowMode | null
  fallback: boolean
  reason?: string
} => {
  const capabilities = getMarketSeriesCapabilities(providerId)
  const allowedModes =
    capabilities?.windowModes && capabilities.windowModes.length > 0
      ? capabilities.windowModes
      : (['range'] as MarketSeriesWindowMode[])
  const interval =
    request.interval || (request.providerParams?.interval as string | undefined)
  const intervalMs = intervalToMs(interval)
  const retention = resolveRetention(providerId, interval)
  // Windows are priority-ordered by the caller; pick the first supported+valid mode.
  const requestedWindows = Array.isArray(request.windows) ? request.windows : []
  let window: PlannedSeriesWindow | null = null
  let resolvedMode: MarketSeriesWindowMode | null = null
  let fallback = false
  let reason: string | undefined

  const requestedPrimaryMode =
    requestedWindows.length > 0 ? requestedWindows[0]?.mode ?? null : null

  for (const candidate of requestedWindows) {
    if (!candidate || !allowedModes.includes(candidate.mode)) continue
    const normalizedCandidate = normalizeSeriesWindow(candidate, [candidate.mode])
    if (!normalizedCandidate) continue
    const normalized = normalizeWindow(normalizedCandidate, intervalMs, retention)
    if (normalized) {
      window = normalized
      resolvedMode = candidate.mode
      break
    }
  }

  if (resolvedMode && requestedPrimaryMode && resolvedMode !== requestedPrimaryMode) {
    fallback = true
    reason = `Window mode ${requestedPrimaryMode} unsupported or invalid; used ${resolvedMode}`
  }

  if (!window) {
    return { request, window: null, mode: null, fallback: false }
  }

  const planned: MarketSeriesRequest = {
    ...request,
    providerParams: request.providerParams ? { ...request.providerParams } : undefined,
  }

  // Keep range windows as range; session-based anchoring happens in market-hours layer.
  if (window.mode === 'absolute') {
    planned.start = new Date(window.startMs).toISOString()
    planned.end = new Date(window.endMs).toISOString()
  } else {
    delete planned.start
    delete planned.end
  }

  // Range param preserves "latest available" semantics for providers that support range windows.
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
      ? window.barCount
      : window.mode === 'range' && intervalMs
        ? Math.ceil(window.rangeMs / intervalMs)
        : null
  if (barCount && planned.providerParams?.limit == null) {
    planned.providerParams = {
      ...(planned.providerParams ?? {}),
      limit: barCount,
    }
  }
  if (
    window.mode === 'bars' &&
    intervalMs &&
    !planned.start &&
    !planned.end
  ) {
    const endMs = Date.now()
    const startMs = Math.max(0, endMs - window.barCount * intervalMs)
    planned.start = new Date(startMs).toISOString()
    planned.end = new Date(endMs).toISOString()
  }

  return { request: planned, window, mode: resolvedMode, fallback, reason }
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

  if (window.mode === 'absolute') {
    filtered = entries.filter((entry) => entry.ts >= window.startMs && entry.ts <= window.endMs)
  }

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
