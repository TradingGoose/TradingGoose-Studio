import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, MarketSeriesWindow } from '@/providers/market/types'
import {
  AreaChartIcon,
  BarDownHollow,
  BarHollow,
  BarSolid,
  BarStroke,
  BarUpHollow,
} from '@/components/icons/icons'

export const CANDLE_TYPE_OPTIONS = [
  { id: 'candle_solid', label: 'Solid', icon: BarSolid },
  { id: 'candle_stroke', label: 'Hollow', icon: BarHollow },
  { id: 'candle_up_stroke', label: 'Up Hollow', icon: BarUpHollow },
  { id: 'candle_down_stroke', label: 'Down Hollow', icon: BarDownHollow },
  { id: 'ohlc', label: 'Bar Stroke', icon: BarStroke },
  { id: 'area', label: 'Area', icon: AreaChartIcon },
] as const

export type DataChartCandleType = (typeof CANDLE_TYPE_OPTIONS)[number]['id']

export type DataChartIndicatorRef = {
  id: string
  isCustom: boolean
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
  window?: MarketSeriesWindow
  fallbackWindow?: MarketSeriesWindow
  live?: {
    enabled?: boolean
    interval?: MarketInterval | string
  }
}

export type DataChartViewParams = {
  locale?: string
  timezone?: string
  pricePrecision?: number
  volumePrecision?: number
  candleType?: DataChartCandleType
  priceAxisType?: 'normal' | 'percentage' | 'log'
  indicators?: DataChartIndicatorRef[]
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
