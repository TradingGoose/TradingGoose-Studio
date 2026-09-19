import type { MarketSeriesRange, MarketSeriesWindow } from '@/providers/market/types'

const DAY_MS = 24 * 60 * 60 * 1000

export const rangeToMs = (range?: MarketSeriesRange): number | null => {
  if (!range) return null
  const value = Number(range.value)
  if (!Number.isFinite(value) || value <= 0) return null
  if (range.unit === 'day') return value * DAY_MS
  if (range.unit === 'week') return value * 7 * DAY_MS
  if (range.unit === 'month') return value * 30 * DAY_MS
  if (range.unit === 'year') return value * 365 * DAY_MS
  return null
}

export const seriesWindowKey = (windows: MarketSeriesWindow[]): string => {
  return windows.length ? JSON.stringify(windows) : 'none'
}
