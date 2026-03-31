import type { MarketBar, MarketSeries } from '@/providers/market/types'

const DAY_MS = 86_400_000
const DEFAULT_BARS = 500
const DEFAULT_INITIAL_PRICE = 100
const DEFAULT_VOLUME_BASE = 1_000_000
const MIN_PRICE = 0.5
const MIN_VOLATILITY = 0.002
const MAX_VOLATILITY = 0.02
const MAX_GAP_RETURN = 0.05
const MAX_STEP_RETURN = 0.03

export type MockMarketBarInput = {
  open: number
  high: number
  low: number
  close: number
  volume?: number | null
}

type MockMarketBarSnapshot = {
  open: number
  high: number
  low: number
  close: number
  volume: number
  turnover: number
}

type GenerateMockMarketSeriesOptions = {
  bars?: number
  initialPrice?: number
  volumeBase?: number
  intervalMs?: number
  endTimeMs?: number
  endClose?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const clampPrice = (value: number) => Math.max(MIN_PRICE, value)

const roundPrice = (value: number) => Number(value.toFixed(2))

const roundVolume = (value: number) => Math.max(0, Math.round(value))

const randomNormal = () => {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

const resolveRangePct = (bar?: MockMarketBarInput | null) => {
  if (!bar) return 0
  const referencePrice = Math.max(MIN_PRICE, bar.close || bar.open || MIN_PRICE)
  return clamp(
    (Math.max(bar.high, bar.open, bar.close) - Math.min(bar.low, bar.open, bar.close)) /
      referencePrice,
    0,
    0.2
  )
}

const resolveVolatility = (previousRangePct: number) =>
  clamp(
    0.0028 + previousRangePct * 0.55 + Math.abs(randomNormal()) * 0.0018 + Math.random() * 0.0015,
    MIN_VOLATILITY,
    MAX_VOLATILITY
  )

const resolveGapReturn = (volatility: number, allowGap: boolean) => {
  if (!allowGap) return 0

  let gap = randomNormal() * volatility * 0.18
  if (Math.random() < 0.05) {
    gap += randomNormal() * volatility * 1.1
  }

  return clamp(gap, -MAX_GAP_RETURN, MAX_GAP_RETURN)
}

const buildIntrabarPath = (open: number, volatility: number) => {
  const steps = 4 + Math.floor(Math.random() * 3)
  const drift = randomNormal() * volatility * 0.18
  const path = [open]
  let price = open

  for (let step = 0; step < steps; step += 1) {
    const shock = Math.random() < 0.08 ? randomNormal() * volatility * 1.4 : 0
    const stepReturn = clamp(
      drift / steps + randomNormal() * volatility * 0.75 + shock,
      -MAX_STEP_RETURN,
      MAX_STEP_RETURN
    )
    price = clampPrice(price * (1 + stepReturn))
    path.push(price)
  }

  return path
}

const applyEventExtremes = (
  open: number,
  close: number,
  high: number,
  low: number,
  volatility: number
) => {
  let nextClose = close
  let nextHigh = high
  let nextLow = low
  let volumeBoost = 0
  const roll = Math.random()

  if (roll < 0.025) {
    const direction = Math.random() < 0.5 ? -1 : 1
    nextClose = clampPrice(close * (1 + direction * volatility * (1.2 + Math.random() * 2.2)))
    volumeBoost = 1.4
  } else if (roll < 0.06) {
    nextHigh = Math.max(
      nextHigh,
      Math.max(open, close) * (1 + volatility * (1 + Math.random() * 2))
    )
    nextClose = clampPrice(close * (1 - volatility * (0.2 + Math.random() * 0.6)))
    volumeBoost = 1
  } else if (roll < 0.095) {
    nextLow = Math.min(nextLow, Math.min(open, close) * (1 - volatility * (1 + Math.random() * 2)))
    nextClose = clampPrice(close * (1 + volatility * (0.2 + Math.random() * 0.6)))
    volumeBoost = 1
  }

  nextHigh = Math.max(nextHigh, open, nextClose)
  nextLow = Math.min(nextLow, open, nextClose)

  if (Math.random() < 0.2) {
    nextHigh = Math.max(
      nextHigh,
      Math.max(open, nextClose) * (1 + volatility * (0.35 + Math.random() * 1.5))
    )
  }

  if (Math.random() < 0.2) {
    nextLow = Math.min(
      nextLow,
      Math.min(open, nextClose) * (1 - volatility * (0.35 + Math.random() * 1.5))
    )
  }

  return {
    close: nextClose,
    high: nextHigh,
    low: nextLow,
    volumeBoost,
  }
}

const buildSnapshot = (
  open: number,
  close: number,
  high: number,
  low: number,
  volumeBase: number,
  volumeBoost = 0
): MockMarketBarSnapshot => {
  const safeOpen = roundPrice(clampPrice(open))
  const safeClose = roundPrice(clampPrice(close))
  const safeHigh = roundPrice(Math.max(high, safeOpen, safeClose))
  const safeLow = roundPrice(Math.min(low, safeOpen, safeClose))
  const trueRangePct = (safeHigh - safeLow) / Math.max(safeOpen, MIN_PRICE)
  const bodyPct = Math.abs(safeClose - safeOpen) / Math.max(safeOpen, MIN_PRICE)
  const volumeMultiplier = 0.6 + Math.random() * 0.85
  const volume = roundVolume(
    volumeBase * volumeMultiplier * (1 + trueRangePct * 18 + bodyPct * 8 + volumeBoost)
  )

  return {
    open: safeOpen,
    high: safeHigh,
    low: safeLow,
    close: safeClose,
    volume,
    turnover: roundPrice(safeClose * volume),
  }
}

const createMockBarSnapshot = ({
  previousClose,
  previousBar,
  volumeBase,
  allowGap,
}: {
  previousClose: number
  previousBar?: MockMarketBarInput | null
  volumeBase: number
  allowGap: boolean
}) => {
  const volatility = resolveVolatility(resolveRangePct(previousBar))
  const open = clampPrice(previousClose * (1 + resolveGapReturn(volatility, allowGap)))
  const path = buildIntrabarPath(open, volatility)
  const pathClose = path[path.length - 1] ?? open
  const pathHigh = Math.max(...path)
  const pathLow = Math.min(...path)
  const event = applyEventExtremes(open, pathClose, pathHigh, pathLow, volatility)

  return buildSnapshot(open, event.close, event.high, event.low, volumeBase, event.volumeBoost)
}

const createMockBars = (
  startDate: Date,
  bars: number,
  initialPrice: number,
  volumeBase: number,
  intervalMs: number
): MarketBar[] => {
  const result: MarketBar[] = []
  let previousClose = Math.max(initialPrice, MIN_PRICE)
  let previousBar: MockMarketBarInput | null = null

  for (let index = 0; index < bars; index += 1) {
    const timestamp = new Date(startDate.getTime() + index * intervalMs)
    const nextBar = createMockBarSnapshot({
      previousClose,
      previousBar,
      volumeBase,
      allowGap: index > 0,
    })

    result.push({
      timeStamp: timestamp.toISOString(),
      open: nextBar.open,
      high: nextBar.high,
      low: nextBar.low,
      close: nextBar.close,
      volume: nextBar.volume,
      turnover: nextBar.turnover,
    })

    previousClose = nextBar.close
    previousBar = nextBar
  }

  return result
}

export const buildNextMockMarketBar = (
  previousBar: MockMarketBarInput,
  options: { volumeBase?: number } = {}
): MockMarketBarSnapshot =>
  createMockBarSnapshot({
    previousClose: previousBar.close,
    previousBar,
    volumeBase: options.volumeBase ?? DEFAULT_VOLUME_BASE,
    allowGap: true,
  })

export const evolveMockMarketBar = (
  currentBar: MockMarketBarInput,
  options: { volumeBase?: number } = {}
): MockMarketBarSnapshot => {
  const volatility = resolveVolatility(resolveRangePct(currentBar)) * 0.45
  const nextClose = clampPrice(
    currentBar.close * (1 + clamp(randomNormal() * volatility * 0.35, -0.015, 0.015))
  )
  let nextHigh = Math.max(currentBar.high, currentBar.open, nextClose)
  let nextLow = Math.min(currentBar.low, currentBar.open, nextClose)

  if (Math.random() < 0.16) {
    nextHigh = Math.max(
      nextHigh,
      Math.max(currentBar.open, nextClose) * (1 + volatility * (0.35 + Math.random() * 1.2))
    )
  }

  if (Math.random() < 0.16) {
    nextLow = Math.min(
      nextLow,
      Math.min(currentBar.open, nextClose) * (1 - volatility * (0.35 + Math.random() * 1.2))
    )
  }

  const volumeBase = Math.max((options.volumeBase ?? DEFAULT_VOLUME_BASE) * 0.001, 1_200)
  const nextSnapshot = buildSnapshot(currentBar.open, nextClose, nextHigh, nextLow, volumeBase)
  const cumulativeVolume = roundVolume((currentBar.volume ?? 0) + nextSnapshot.volume)

  return {
    ...nextSnapshot,
    volume: cumulativeVolume,
    turnover: roundPrice(nextSnapshot.close * cumulativeVolume),
  }
}

const rebaseSeriesToEndClose = (bars: MarketBar[], targetEndClose?: number): MarketBar[] => {
  if (!bars.length) return bars
  if (
    typeof targetEndClose !== 'number' ||
    !Number.isFinite(targetEndClose) ||
    targetEndClose <= 0
  ) {
    return bars
  }

  const lastClose = bars[bars.length - 1]?.close
  if (typeof lastClose !== 'number' || !Number.isFinite(lastClose) || lastClose <= 0) {
    return bars
  }

  const scale = targetEndClose / lastClose
  if (!Number.isFinite(scale) || scale <= 0) return bars

  return bars.map((bar) => {
    const open = roundPrice((bar.open ?? bar.close ?? 0) * scale)
    const close = roundPrice((bar.close ?? bar.open ?? 0) * scale)
    const high = roundPrice((bar.high ?? Math.max(open, close)) * scale)
    const low = roundPrice((bar.low ?? Math.min(open, close)) * scale)
    const volume = bar.volume ?? 0

    return {
      ...bar,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      turnover: roundPrice(close * volume),
    }
  })
}

export function generateMockMarketSeries(
  options: GenerateMockMarketSeriesOptions = {}
): MarketSeries {
  const bars = options.bars ?? DEFAULT_BARS
  const intervalMs =
    typeof options.intervalMs === 'number' &&
    Number.isFinite(options.intervalMs) &&
    options.intervalMs > 0
      ? options.intervalMs
      : DAY_MS
  const endTimeMs =
    typeof options.endTimeMs === 'number' && Number.isFinite(options.endTimeMs)
      ? options.endTimeMs
      : Date.now()
  const endDate = new Date(endTimeMs)
  const startDate = new Date(endDate.getTime() - Math.max(0, bars - 1) * intervalMs)
  const seriesBars = createMockBars(
    startDate,
    bars,
    options.initialPrice ?? DEFAULT_INITIAL_PRICE,
    options.volumeBase ?? DEFAULT_VOLUME_BASE,
    intervalMs
  )
  const normalizedBars = rebaseSeriesToEndClose(seriesBars, options.endClose)

  return {
    start: normalizedBars[0]?.timeStamp,
    end: normalizedBars[normalizedBars.length - 1]?.timeStamp,
    timezone: 'UTC',
    bars: normalizedBars,
  }
}
