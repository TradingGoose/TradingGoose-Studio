import type { Chart, KLineData } from 'klinecharts'
import type { MarketBar, MarketSeries } from '@/providers/market/types'

export const resolveProviderErrorMessage = (payload: any, fallback: string) => {
  const raw = payload?.error
  if (!raw) return fallback
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const code = typeof raw.code === 'string' ? raw.code : ''
    const message = typeof raw.message === 'string' ? raw.message : fallback
    return code ? `${code}: ${message}` : message
  }
  return fallback
}

export const clearChartData = (chart: Chart) => {
  chart.resetData()
}

export const mapMarketBarToData = (bar?: MarketBar | null): KLineData | null => {
  if (!bar) return null
  const timestamp = new Date(bar.timeStamp).getTime()
  if (!Number.isFinite(timestamp)) return null
  return {
    timestamp,
    open: bar.open ?? bar.close ?? 0,
    high: bar.high ?? bar.close ?? 0,
    low: bar.low ?? bar.close ?? 0,
    close: bar.close ?? bar.open ?? 0,
    volume: bar.volume ?? undefined,
    turnover: bar.turnover ?? undefined,
  } as KLineData
}

export const mapMarketSeriesToData = (series: MarketSeries): KLineData[] => {
  const mapped = series.bars
    .map((bar) => mapMarketBarToData(bar))
    .filter((entry): entry is KLineData => Boolean(entry))

  return mapped.sort((a, b) => a.timestamp - b.timestamp)
}

const resolveChartWidth = (chart: Chart, container: HTMLDivElement | null) => {
  const paneSize = chart.getSize('candle_pane', 'main')
  if (paneSize?.width && paneSize.width > 0) return paneSize.width
  const rootSize = chart.getSize()
  if (rootSize?.width && rootSize.width > 0) return rootSize.width
  if (container?.clientWidth && container.clientWidth > 0) return container.clientWidth
  return 0
}

export const fitChartToData = (
  chart: Chart,
  data: KLineData[],
  container: HTMLDivElement | null,
  targetBars?: number | null
) => {
  if (!data.length) return false
  const width = resolveChartWidth(chart, container)
  if (!width) return false
  const offsetRight =
    typeof chart.getOffsetRightDistance === 'function' ? chart.getOffsetRightDistance() : 0
  const usableWidth = Math.max(0, width - offsetRight)
  const barCount =
    typeof targetBars === 'number' && Number.isFinite(targetBars) && targetBars > 0
      ? Math.max(data.length, Math.floor(targetBars))
      : data.length
  const targetBarSpace = Math.ceil(usableWidth / barCount)
  const barSpace = Math.max(1, Math.min(50, targetBarSpace))
  chart.setBarSpace(barSpace)
  chart.scrollToRealTime()
  return true
}
