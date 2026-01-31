import type { MarketBar, MarketInterval, MarketRangeUnit, MarketSeries } from '@/providers/market/types'
import type { DataChartCandleType } from '@/widgets/widgets/new_data_chart/types'

export const DEFAULT_BAR_COUNT = 500

export type RangePreset = {
  id: string
  label: string
  range: { value: number; unit: MarketRangeUnit }
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

export type BarMs = {
  openTime: number
  closeTime: number
  open: number
  high: number
  low: number
  close: number
  volume?: number
  turnover?: number
}

type OhlcSec = {
  time: number
  open: number
  high: number
  low: number
  close: number
}

type LineSec = {
  time: number
  value: number
}

const toSeconds = (ms: number) => Math.floor(ms / 1000)

const recomputeCloseTimes = (bars: BarMs[], intervalMs?: number | null): BarMs[] => {
  if (bars.length === 0) return bars
  const nextBars = bars.map((bar) => ({ ...bar }))
  for (let i = 0; i < nextBars.length; i += 1) {
    const current = nextBars[i]
    const next = nextBars[i + 1]
    if (next) {
      current.closeTime = next.openTime
    } else if (intervalMs) {
      current.closeTime = current.openTime + intervalMs
    } else {
      current.closeTime = current.openTime
    }
  }
  return nextBars
}

export const mapMarketBarToBarMs = (
  bar?: MarketBar | null,
  intervalMs?: number | null
): BarMs | null => {
  if (!bar) return null
  const timestamp = Date.parse(bar.timeStamp)
  if (!Number.isFinite(timestamp)) return null
  const open = bar.open ?? bar.close ?? 0
  const close = bar.close ?? bar.open ?? 0
  const high = bar.high ?? bar.close ?? 0
  const low = bar.low ?? bar.close ?? 0
  const openTime = timestamp
  const closeTime = intervalMs ? openTime + intervalMs : openTime

  return {
    openTime,
    closeTime,
    open,
    high,
    low,
    close,
    volume: bar.volume ?? undefined,
    turnover: bar.turnover ?? undefined,
  }
}

export const mapMarketSeriesToBarsMs = (
  series: MarketSeries,
  intervalMs?: number | null
): BarMs[] => {
  const map = new Map<number, BarMs>()

  series.bars.forEach((bar) => {
    const mapped = mapMarketBarToBarMs(bar, intervalMs)
    if (!mapped) return
    map.set(mapped.openTime, mapped)
  })

  const merged = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime)
  return recomputeCloseTimes(merged, intervalMs)
}

export const mapBarsMsToOhlcSec = (barsMs: BarMs[]): OhlcSec[] =>
  barsMs.map((bar) => ({
    time: toSeconds(bar.openTime),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }))

export const mapBarsMsToLineSec = (barsMs: BarMs[]): LineSec[] =>
  barsMs.map((bar) => ({
    time: toSeconds(bar.openTime),
    value: bar.close,
  }))

export const mapBarMsToSeriesDatum = (
  bar: BarMs,
  candleType?: DataChartCandleType | string | null
): OhlcSec | LineSec => {
  if (candleType === 'area') {
    return { time: toSeconds(bar.openTime), value: bar.close }
  }
  return {
    time: toSeconds(bar.openTime),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }
}

export const mapBarsMsToSeriesData = (
  barsMs: BarMs[],
  candleType?: DataChartCandleType | string | null
): Array<OhlcSec | LineSec> => {
  if (candleType === 'area') return mapBarsMsToLineSec(barsMs)
  return mapBarsMsToOhlcSec(barsMs)
}

export const mergeBarsMs = (
  base: BarMs[],
  incoming: BarMs[],
  intervalMs?: number | null
): BarMs[] => {
  if (incoming.length === 0) return base
  if (base.length === 0) return recomputeCloseTimes([...incoming], intervalMs)

  const map = new Map<number, BarMs>()
  base.forEach((bar) => {
    map.set(bar.openTime, bar)
  })
  incoming.forEach((bar) => {
    map.set(bar.openTime, bar)
  })

  const merged = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime)
  return recomputeCloseTimes(merged, intervalMs)
}

export const buildIndexMaps = (barsMs: BarMs[]) => {
  const indexByOpenTimeMs = new Map<number, number>()
  const openTimeMsByIndex: number[] = []

  barsMs.forEach((bar, index) => {
    indexByOpenTimeMs.set(bar.openTime, index)
    openTimeMsByIndex.push(bar.openTime)
  })

  return { indexByOpenTimeMs, openTimeMsByIndex }
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
