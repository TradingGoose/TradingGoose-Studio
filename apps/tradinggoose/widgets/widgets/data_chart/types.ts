import type { MutableRefObject } from 'react'
import type { IPaneApi, ISeriesApi } from 'lightweight-charts'
import type { MarketSessionWindow } from '@/providers/market/types'
import type { BarMs } from '@/widgets/widgets/data_chart/series-data'

export type IndicatorRuntimePlot = {
  key: string
  title: string
  color?: string
  series: ISeriesApi<any>
}

export type IndicatorRuntimeEntry = {
  id: string
  pane: IPaneApi<any> | null
  paneIndex: number
  plots: IndicatorRuntimePlot[]
  paneAnchorSeries?: ISeriesApi<any> | null
  paneAnchorIdentity?: string | null
  errorMessage?: string
}

export type DataChartDataContext = {
  barsMsRef: MutableRefObject<BarMs[]>
  indexByOpenTimeMsRef: MutableRefObject<Map<number, number>>
  openTimeMsByIndexRef: MutableRefObject<number[]>
  marketSessionsRef: MutableRefObject<MarketSessionWindow[]>
  intervalMs: number | null
  dataVersion: number
}
