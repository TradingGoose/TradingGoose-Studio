import type {
  MarketBar,
  MarketInterval,
  MarketRangeUnit,
  MarketSeries,
} from '@/providers/market/types'
import type { DataChartCandleType } from '@/widgets/widgets/data_chart/types'

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
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const normalizeOhlc = (
  open: number,
  high: number,
  low: number,
  close: number
): { open: number; high: number; low: number; close: number } | null => {
  if (![open, high, low, close].every((value) => Number.isFinite(value))) {
    return null
  }

  // Keep OHLC invariants strict to prevent chart-internal bar lookup corruption.
  const normalizedHigh = Math.max(high, open, close)
  const normalizedLow = Math.min(low, open, close)

  if (!Number.isFinite(normalizedHigh) || !Number.isFinite(normalizedLow)) {
    return null
  }

  return {
    open,
    high: normalizedHigh,
    low: normalizedLow,
    close,
  }
}

const coerceFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const clampTimestampToChartResolution = (timestamp: number): number => {
  // lightweight-charts numeric times are second-based.
  return Math.floor(timestamp / 1000) * 1000
}

const mergeClampedBars = (base: BarMs, incoming: BarMs): BarMs => {
  const volume =
    typeof base.volume === 'number' || typeof incoming.volume === 'number'
      ? (base.volume ?? 0) + (incoming.volume ?? 0)
      : undefined
  const turnover =
    typeof base.turnover === 'number' || typeof incoming.turnover === 'number'
      ? (base.turnover ?? 0) + (incoming.turnover ?? 0)
      : undefined

  return {
    ...base,
    high: Math.max(base.high, incoming.high),
    low: Math.min(base.low, incoming.low),
    close: incoming.close,
    volume,
    turnover,
  }
}

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
  const openValue = coerceFiniteNumber(bar.open)
  const closeValue = coerceFiniteNumber(bar.close)
  const fallback = closeValue ?? openValue
  if (fallback === null) return null
  const open = openValue ?? closeValue ?? fallback
  const close = closeValue ?? openValue ?? fallback
  const highValue = coerceFiniteNumber(bar.high)
  const lowValue = coerceFiniteNumber(bar.low)
  const normalizedOhlc = normalizeOhlc(
    open,
    highValue ?? Math.max(open, close),
    lowValue ?? Math.min(open, close),
    close
  )
  if (!normalizedOhlc) return null
  // Preserve provider bar anchors across ranges/intervals; only coerce to second precision for LWC.
  const openTime = clampTimestampToChartResolution(timestamp)
  const closeTime = intervalMs ? openTime + intervalMs : openTime
  const volume = coerceFiniteNumber(bar.volume) ?? undefined
  const turnover = coerceFiniteNumber(bar.turnover) ?? undefined

  return {
    openTime,
    closeTime,
    ...normalizedOhlc,
    volume,
    turnover,
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
    const existing = map.get(mapped.openTime)
    map.set(mapped.openTime, existing ? mergeClampedBars(existing, mapped) : mapped)
  })

  const merged = Array.from(map.values()).sort((a, b) => a.openTime - b.openTime)
  return recomputeCloseTimes(merged, intervalMs)
}

export const mapBarsMsToOhlcSec = (barsMs: BarMs[]): OhlcSec[] =>
  barsMs.flatMap((bar) => {
    const time = toSeconds(bar.openTime)
    if (!Number.isFinite(time)) return []
    if (
      !Number.isFinite(bar.open) ||
      !Number.isFinite(bar.high) ||
      !Number.isFinite(bar.low) ||
      !Number.isFinite(bar.close)
    ) {
      return []
    }
    return [
      {
        time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      },
    ]
  })

export const mapBarsMsToLineSec = (barsMs: BarMs[]): LineSec[] =>
  barsMs.flatMap((bar) => {
    const time = toSeconds(bar.openTime)
    if (!Number.isFinite(time)) return []
    if (!Number.isFinite(bar.close)) return []
    return [
      {
        time,
        value: bar.close,
      },
    ]
  })

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

const getSeriesDatumError = (
  entry: OhlcSec | LineSec,
  isLine: boolean,
  previousTime: number | null
): string | null => {
  if (!entry || typeof entry !== 'object') return 'entry'
  if (!isFiniteNumber(entry.time)) return 'time'
  if (previousTime !== null && entry.time <= previousTime) return 'time-order'
  if (isLine) {
    if (!isFiniteNumber((entry as LineSec).value)) return 'value'
    return null
  }
  const ohlc = entry as OhlcSec
  if (!isFiniteNumber(ohlc.open)) return 'open'
  if (!isFiniteNumber(ohlc.high)) return 'high'
  if (!isFiniteNumber(ohlc.low)) return 'low'
  if (!isFiniteNumber(ohlc.close)) return 'close'
  if (ohlc.high < ohlc.low) return 'high-low'
  if (ohlc.high < Math.max(ohlc.open, ohlc.close)) return 'high-bound'
  if (ohlc.low > Math.min(ohlc.open, ohlc.close)) return 'low-bound'
  return null
}

export const sanitizeSeriesData = (
  data: Array<OhlcSec | LineSec>,
  candleType?: DataChartCandleType | string | null
): Array<OhlcSec | LineSec> => {
  if (!Array.isArray(data) || data.length === 0) return []
  const isLine = candleType === 'area'
  const next: Array<OhlcSec | LineSec> = []
  let lastTime: number | null = null
  data.forEach((entry) => {
    const error = getSeriesDatumError(entry, isLine, lastTime)
    if (error) return
    lastTime = entry.time
    next.push(entry)
  })
  return next
}

export const findFirstInvalidSeriesDatum = (
  data: Array<OhlcSec | LineSec>,
  candleType?: DataChartCandleType | string | null
): { entry: OhlcSec | LineSec; error: string; index: number } | null => {
  if (!Array.isArray(data) || data.length === 0) return null
  const isLine = candleType === 'area'
  let lastTime: number | null = null
  for (let index = 0; index < data.length; index += 1) {
    const entry = data[index]
    const error = getSeriesDatumError(entry, isLine, lastTime)
    if (error) {
      return entry ? { entry, error, index } : null
    }
    lastTime = entry.time
  }
  return null
}

export const mergeBarsMs = (
  base: BarMs[],
  incoming: BarMs[],
  intervalMs?: number | null
): BarMs[] => {
  if (incoming.length === 0) return base
  if (base.length === 0) return recomputeCloseTimes([...incoming], intervalMs)

  const baseFirst = base[0]?.openTime
  const baseLast = base[base.length - 1]?.openTime
  const incomingFirst = incoming[0]?.openTime
  const incomingLast = incoming[incoming.length - 1]?.openTime

  if (
    typeof baseFirst === 'number' &&
    typeof baseLast === 'number' &&
    typeof incomingFirst === 'number' &&
    typeof incomingLast === 'number'
  ) {
    if (incomingLast < baseFirst) {
      return recomputeCloseTimes([...incoming, ...base], intervalMs)
    }
    if (incomingFirst > baseLast) {
      return recomputeCloseTimes([...base, ...incoming], intervalMs)
    }
  }

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
