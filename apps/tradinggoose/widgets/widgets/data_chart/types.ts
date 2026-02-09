import type { MutableRefObject } from 'react'
import type { IPaneApi, ISeriesApi } from 'lightweight-charts'
import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, MarketSessionWindow } from '@/providers/market/types'
import type { BarMs } from '@/widgets/widgets/data_chart/series-data'

export type DataChartCandleType =
  | 'candle_solid'
  | 'candle_stroke'
  | 'candle_up_stroke'
  | 'candle_down_stroke'
  | 'ohlc'
  | 'area'

export type IndicatorRef = {
  id: string
  inputs?: Record<string, unknown>
  visible?: boolean
}

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
  errorMessage?: string
}

export type DataChartAuthParams = {
  apiKey?: string
  apiSecret?: string
  [key: string]: unknown
}

export type DataChartDataParams = {
  provider?: string
  providerParams?: Record<string, unknown>
  auth?: DataChartAuthParams
  interval?: MarketInterval | string
  live?: {
    enabled?: boolean
    interval?: MarketInterval | string
  }
}

export type DataChartViewParams = {
  locale?: string
  timezone?: string
  start?: number
  end?: number
  interval?: MarketInterval | string
  marketSession?: 'regular' | 'extended'
  pricePrecision?: number
  volumePrecision?: number
  candleType?: DataChartCandleType
  priceAxisType?: 'normal' | 'percentage' | 'log'
  pineIndicators?: IndicatorRef[]
  rangePresetId?: string
  stylesOverride?: Record<string, unknown>
}

export type DataChartWidgetParams = {
  workflowId?: string
  listing?: ListingIdentity | null
  data?: DataChartDataParams
  view?: DataChartViewParams
  runtime?: {
    refreshAt?: number
  }
}

export type dataChartWidgetParams = DataChartWidgetParams

export type DataChartDataContext = {
  barsMsRef: MutableRefObject<BarMs[]>
  indexByOpenTimeMsRef: MutableRefObject<Map<number, number>>
  openTimeMsByIndexRef: MutableRefObject<number[]>
  marketSessionsRef: MutableRefObject<MarketSessionWindow[]>
  intervalMs: number | null
  dataVersion: number
}
