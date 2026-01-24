import type {
  MarketSeriesRange,
  MarketSeriesWindow,
  MarketSeriesWindowMode,
} from '@/providers/market/types'

const DAY_MS = 24 * 60 * 60 * 1000

const parseDateInput = (value?: string | number | null): Date | null => {
  if (value === undefined || value === null) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

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

export const normalizeSeriesWindow = (
  window: MarketSeriesWindow | undefined,
  allowedModes: MarketSeriesWindowMode[]
): MarketSeriesWindow | null => {
  if (!window) return null
  if (!allowedModes.includes(window.mode)) return null

  if (window.mode === 'range') {
    const rangeMs = rangeToMs(window.range)
    return rangeMs && rangeMs > 0 ? window : null
  }

  if (window.mode === 'bars') {
    const barCount = Number(window.barCount)
    return Number.isFinite(barCount) && barCount > 0
      ? { mode: 'bars', barCount: Math.floor(barCount) }
      : null
  }

  const start = parseDateInput(window.start)
  if (!start) return null
  const end = window.end ? parseDateInput(window.end) : null

  return {
    mode: 'absolute',
    start: start.toISOString(),
    end: end ? end.toISOString() : undefined,
  }
}

export const normalizeSeriesWindows = (
  windows: Array<MarketSeriesWindow | undefined>,
  allowedModes: MarketSeriesWindowMode[]
): MarketSeriesWindow[] => {
  const normalized: MarketSeriesWindow[] = []

  windows.forEach((window) => {
    const next = normalizeSeriesWindow(window, allowedModes)
    if (next) normalized.push(next)
  })

  return normalized
}

export const seriesWindowKey = (windows: MarketSeriesWindow[]): string => {
  return windows.length ? JSON.stringify(windows) : 'none'
}

export const areSeriesWindowsEqual = (
  a?: MarketSeriesWindow | null,
  b?: MarketSeriesWindow | null
): boolean => {
  if (!a || !b) return false
  if (a.mode !== b.mode) return false
  if (a.mode === 'range' && b.mode === 'range') {
    return a.range.value === b.range.value && a.range.unit === b.range.unit
  }
  if (a.mode === 'bars' && b.mode === 'bars') {
    return a.barCount === b.barCount
  }
  if (a.mode === 'absolute' && b.mode === 'absolute') {
    return a.start === b.start && a.end === b.end
  }
  return false
}
