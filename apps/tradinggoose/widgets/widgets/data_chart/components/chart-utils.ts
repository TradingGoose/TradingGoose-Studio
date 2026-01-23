import type { Chart, KLineData } from 'klinecharts'

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
  const instance = chart as unknown as {
    clearData?: () => void
    applyNewData?: (data: KLineData[]) => void
    setData?: (data: KLineData[]) => void
  }
  if (typeof instance.clearData === 'function') {
    instance.clearData()
    return
  }
  if (typeof instance.applyNewData === 'function') {
    instance.applyNewData([])
    return
  }
  if (typeof instance.setData === 'function') {
    instance.setData([])
  }
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
  container: HTMLDivElement | null
) => {
  if (!data.length) return
  const width = resolveChartWidth(chart, container)
  if (!width) return
  const offsetRight =
    typeof chart.getOffsetRightDistance === 'function' ? chart.getOffsetRightDistance() : 0
  const usableWidth = Math.max(0, width - offsetRight)
  const targetBarSpace = Math.ceil(usableWidth / data.length)
  const barSpace = Math.max(1, Math.min(50, targetBarSpace))
  chart.setBarSpace(barSpace)
  chart.scrollToRealTime()
}
