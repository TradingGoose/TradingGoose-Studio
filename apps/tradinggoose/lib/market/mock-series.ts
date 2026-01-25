import type { KLineData } from 'klinecharts'
import type { MarketBar, MarketSeries } from '@/providers/market/types'

const DAY_MS = 86_400_000
const DEFAULT_BARS = 500
const DEFAULT_INITIAL_PRICE = 100
const DEFAULT_VOLUME_BASE = 1_000_000
const MIN_PRICE = 0.5

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const roundPrice = (value: number) => Number(value.toFixed(2))

const roundVolume = (value: number) => Math.max(0, Math.round(value))

const randomNormal = () => {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

const createMockBars = (
  startDate: Date,
  bars: number,
  initialPrice: number,
  volumeBase: number
): MarketBar[] => {
  const result: MarketBar[] = []
  let currentPrice = Math.max(initialPrice, MIN_PRICE)

  const drift = 0.0002
  const sigma = 0.006
  const maxMove = 0.03

  for (let i = 0; i < bars; i += 1) {
    const timestamp = new Date(startDate.getTime() + i * DAY_MS)
    const dailyReturn = clamp(drift + randomNormal() * sigma, -maxMove, maxMove)

    const open = currentPrice
    const close = Math.max(MIN_PRICE, open * (1 + dailyReturn))

    const baseRange = Math.max(Math.abs(dailyReturn) * 0.6, 0.002)
    const extraRange = Math.random() * 0.002
    const range = baseRange + extraRange

    const high = Math.max(open, close) * (1 + range)
    const low = Math.min(open, close) * (1 - range)

    const volumeMultiplier = 0.9 + Math.random() * 0.2
    const volatilityBoost = 1 + Math.abs(dailyReturn) * 8
    const volume = volumeBase * volatilityBoost * volumeMultiplier

    result.push({
      timeStamp: timestamp.toISOString(),
      open: roundPrice(open),
      high: roundPrice(high),
      low: roundPrice(low),
      close: roundPrice(close),
      volume: roundVolume(volume),
      turnover: roundPrice(roundPrice(close) * roundVolume(volume)),
    })

    currentPrice = close
  }

  return result
}

export function generateMockMarketSeries(): MarketSeries {
  const bars = DEFAULT_BARS
  const endDate = new Date()
  const startDate = new Date(endDate.getTime() - bars * DAY_MS)

  const seriesBars = createMockBars(
    startDate,
    bars,
    DEFAULT_INITIAL_PRICE,
    DEFAULT_VOLUME_BASE
  )

  return {
    start: seriesBars[0]?.timeStamp,
    end: seriesBars[seriesBars.length - 1]?.timeStamp,
    timezone: 'UTC',
    bars: seriesBars,
  }
}

export function marketSeriesToKLineData(series: MarketSeries): KLineData[] {
  const bars = Array.isArray(series?.bars) ? series.bars : []

  return bars
    .map((bar) => {
      const timestamp = new Date(bar.timeStamp).getTime()
      if (!Number.isFinite(timestamp)) return null

      const close = bar.close ?? bar.open ?? 0
      const open = bar.open ?? close
      const high = bar.high ?? Math.max(open, close)
      const low = bar.low ?? Math.min(open, close)

      return {
        timestamp,
        open,
        high,
        low,
        close,
        volume: bar.volume ?? undefined,
        turnover: bar.turnover ?? undefined,
      } as KLineData
    })
    .filter((entry): entry is KLineData => Boolean(entry))
    .sort((a, b) => a.timestamp - b.timestamp)
}
