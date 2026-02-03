import type { MarketBar, MarketSeries } from '@/providers/market/types'
import type { BarMs } from '@/lib/new_indicators/types'

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

export const normalizeBarsMs = (barsMs: BarMs[], intervalMs?: number | null): BarMs[] => {
  if (!Array.isArray(barsMs) || barsMs.length === 0) return []
  const map = new Map<number, BarMs>()
  barsMs.forEach((bar) => {
    if (!bar || !Number.isFinite(bar.openTime)) return
    const openTime = bar.openTime
    const closeTime =
      Number.isFinite(bar.closeTime) && bar.closeTime > 0 ? bar.closeTime : openTime
    map.set(openTime, {
      openTime,
      closeTime,
      open: Number.isFinite(bar.open) ? bar.open : 0,
      high: Number.isFinite(bar.high) ? bar.high : 0,
      low: Number.isFinite(bar.low) ? bar.low : 0,
      close: Number.isFinite(bar.close) ? bar.close : 0,
      volume: Number.isFinite(bar.volume ?? NaN) ? bar.volume : undefined,
    })
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

