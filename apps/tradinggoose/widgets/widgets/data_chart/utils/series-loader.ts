import { toDate } from '@/providers/market/market-hours/date-utils'
import { intervalToMs } from '@/providers/market/series-planner'
import { rangeToMs } from '@/providers/market/series-window'
import type { MarketSeries, MarketSeriesWindow } from '@/providers/market/types'
import { DEFAULT_BAR_COUNT } from '@/widgets/widgets/data_chart/series-data'

const resolveWindowSpanMs = (window: MarketSeriesWindow, intervalMs?: number | null) => {
  if (window.mode === 'range') return rangeToMs(window.range)
  if (window.mode === 'bars') {
    if (!intervalMs) return null
    const spanMs = intervalMs * window.barCount
    return spanMs > 0 ? spanMs : null
  }
  const startMs = toDate(window.start)?.getTime()
  const endMs = toDate(window.end)?.getTime() ?? Date.now()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const spanMs = Number(endMs) - Number(startMs)
  return spanMs > 0 ? spanMs : null
}

export const assertMarketSeries = (
  payload: unknown,
  invalidPayloadMessage: string
): MarketSeries => {
  if (!payload || typeof payload !== 'object') {
    throw new Error(invalidPayloadMessage)
  }
  const series = payload as MarketSeries
  if (!Array.isArray(series.bars)) {
    throw new Error(invalidPayloadMessage)
  }
  return series
}

export const resolveExpectedBars = (
  window: MarketSeriesWindow | undefined,
  interval?: string | null
): number | null => {
  const intervalMs = intervalToMs(interval)
  if (!intervalMs || !window) return null

  if (window.mode === 'bars') return window.barCount
  if (window.mode === 'range') {
    const spanMs = rangeToMs(window.range)
    return spanMs ? Math.ceil(spanMs / intervalMs) : null
  }

  const spanMs = resolveWindowSpanMs(window, intervalMs)
  return spanMs ? Math.ceil(spanMs / intervalMs) : null
}

export const resolveForwardSpanMs = ({
  window,
  interval,
  lastWindowSpanMs,
  defaultBarCount = DEFAULT_BAR_COUNT,
}: {
  window?: MarketSeriesWindow | null
  interval?: string | null
  lastWindowSpanMs?: number | null
  defaultBarCount?: number
}): number | null => {
  const intervalMs = intervalToMs(interval)
  const minimumSpanMs = intervalMs ? intervalMs * defaultBarCount : null

  if (lastWindowSpanMs) {
    if (minimumSpanMs && lastWindowSpanMs < minimumSpanMs) return minimumSpanMs
    return lastWindowSpanMs
  }

  if (!window) return minimumSpanMs ?? null

  const spanMs = resolveWindowSpanMs(window, intervalMs)
  if (!spanMs || spanMs <= 0) return minimumSpanMs ?? null

  if (minimumSpanMs) return Math.max(spanMs, minimumSpanMs)
  return spanMs
}

export const resolveSeriesSpanMs = ({
  series,
  interval,
  defaultBarCount = DEFAULT_BAR_COUNT,
}: {
  series: MarketSeries
  interval?: string | null
  defaultBarCount?: number
}): number | null => {
  const startMs = toDate(series.start)?.getTime()
  const endMs = toDate(series.end)?.getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null
  const spanMs = Number(endMs) - Number(startMs)
  if (spanMs <= 0) return null

  const intervalMs = intervalToMs(interval)
  if (!intervalMs || !defaultBarCount) return spanMs
  return Math.max(spanMs, intervalMs * defaultBarCount)
}
