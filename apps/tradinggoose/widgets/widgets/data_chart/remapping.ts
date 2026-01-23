import type { MarketInterval } from '@/providers/market/types'
import type { Period } from 'klinecharts'

export const DEFAULT_BAR_COUNT = 500

export type RangeUnit = 'day' | 'week' | 'month' | 'year'

export type RangePreset = {
  id: string
  label: string
  range: { value: number; unit: RangeUnit }
  interval?: MarketInterval
}

export const DEFAULT_RANGE_PRESETS: RangePreset[] = [
  { id: '1d', label: '1D', range: { value: 1, unit: 'day' }, interval: '1m' },
  { id: '5d', label: '5D', range: { value: 5, unit: 'day' }, interval: '5m' },
  { id: '1w', label: '1W', range: { value: 1, unit: 'week' }, interval: '10m' },
  { id: '1m', label: '1M', range: { value: 1, unit: 'month' }, interval: '30m' },
  { id: '3m', label: '3M', range: { value: 3, unit: 'month' }, interval: '1h' },
  { id: '6m', label: '6M', range: { value: 6, unit: 'month' }, interval: '4h' },
  { id: '1y', label: '1Y', range: { value: 1, unit: 'year' }, interval: '1d' },
  { id: '5y', label: '5Y', range: { value: 5, unit: 'year' }, interval: '1w' },
  { id: 'all', label: 'ALL', range: { value: 50, unit: 'year' }, interval: '1mo' },
]

export const STANDARD_INTERVAL_MAP: Record<MarketInterval, Period> = {
  '1m': { span: 1, type: 'minute' },
  '2m': { span: 2, type: 'minute' },
  '3m': { span: 3, type: 'minute' },
  '5m': { span: 5, type: 'minute' },
  '10m': { span: 10, type: 'minute' },
  '15m': { span: 15, type: 'minute' },
  '30m': { span: 30, type: 'minute' },
  '45m': { span: 45, type: 'minute' },
  '1h': { span: 1, type: 'hour' },
  '2h': { span: 2, type: 'hour' },
  '3h': { span: 3, type: 'hour' },
  '4h': { span: 4, type: 'hour' },
  '1d': { span: 1, type: 'day' },
  '1w': { span: 1, type: 'week' },
  '2w': { span: 2, type: 'week' },
  '1mo': { span: 1, type: 'month' },
  '3mo': { span: 3, type: 'month' },
  '6mo': { span: 6, type: 'month' },
  '12mo': { span: 1, type: 'year' },
}

export const formatIntervalLabel = (interval: string): string => {
  const match = interval.match(/^(\d+)(m|h|d|w|mo)$/)
  if (!match) return interval
  const value = Number(match[1])
  const unitCode = match[2]
  const unit =
    unitCode === 'm'
      ? 'minute'
      : unitCode === 'h'
        ? 'hour'
        : unitCode === 'd'
          ? 'day'
          : unitCode === 'w'
            ? 'week'
            : 'month'
  return `${value} ${unit}${value === 1 ? '' : 's'}`
}

export const intervalToPeriod = (
  interval?: MarketInterval | string | null
): Period | null => {
  if (!interval) return null
  if (interval in STANDARD_INTERVAL_MAP) {
    return STANDARD_INTERVAL_MAP[interval as MarketInterval]
  }
  return null
}

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
  '1w': 7 * 24 * 60 * 60 * 1000,
  '2w': 14 * 24 * 60 * 60 * 1000,
  '1mo': 30 * 24 * 60 * 60 * 1000,
  '3mo': 90 * 24 * 60 * 60 * 1000,
  '6mo': 180 * 24 * 60 * 60 * 1000,
  '12mo': 365 * 24 * 60 * 60 * 1000,
}

export const intervalToMs = (interval?: MarketInterval | string | null): number | null => {
  if (!interval) return null
  if (interval in INTERVAL_MS) {
    return INTERVAL_MS[interval as MarketInterval]
  }
  return null
}

export const addRangeToDate = (date: Date, range: RangePreset['range']): Date => {
  const next = new Date(date)
  if (range.unit === 'day') {
    next.setDate(next.getDate() + range.value)
  } else if (range.unit === 'week') {
    next.setDate(next.getDate() + range.value * 7)
  } else if (range.unit === 'month') {
    next.setMonth(next.getMonth() + range.value)
  } else {
    next.setFullYear(next.getFullYear() + range.value)
  }
  return next
}

export const subtractRangeFromDate = (date: Date, range: RangePreset['range']): Date => {
  return addRangeToDate(date, { value: -range.value, unit: range.unit })
}
