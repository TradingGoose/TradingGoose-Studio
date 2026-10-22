import type {
  MarketInterval,
  MarketSeriesRange,
  MarketSeriesWindow,
} from '@/providers/market/types'

type RangePreset = {
  id: string
  window: Extract<MarketSeriesWindow, { mode: 'range' | 'all' }>
  interval?: MarketInterval
}

export const DEFAULT_RANGE_PRESETS = [
  { id: '1d', window: { mode: 'range', range: { value: 1, unit: 'day' } }, interval: '1m' },
  { id: '5d', window: { mode: 'range', range: { value: 5, unit: 'day' } }, interval: '5m' },
  { id: '1w', window: { mode: 'range', range: { value: 1, unit: 'week' } }, interval: '10m' },
  { id: '1m', window: { mode: 'range', range: { value: 1, unit: 'month' } }, interval: '30m' },
  { id: '3m', window: { mode: 'range', range: { value: 3, unit: 'month' } }, interval: '1h' },
  { id: '6m', window: { mode: 'range', range: { value: 6, unit: 'month' } }, interval: '4h' },
  { id: '1y', window: { mode: 'range', range: { value: 1, unit: 'year' } }, interval: '1d' },
  { id: '5y', window: { mode: 'range', range: { value: 5, unit: 'year' } }, interval: '1w' },
  { id: 'all', window: { mode: 'all' } },
] as const satisfies readonly RangePreset[]

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
