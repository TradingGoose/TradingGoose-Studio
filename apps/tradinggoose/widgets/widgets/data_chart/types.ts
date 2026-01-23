import type { ListingIdentity } from '@/lib/listing/identity'
import type { MarketInterval, NormalizationMode } from '@/providers/market/types'
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
export type DataChartCandleOption = (typeof CANDLE_TYPE_OPTIONS)[number]

export type DataChartWindow = {
  mode: 'bars' | 'range'
  barCount?: number
  range?: { value: number; unit: 'day' | 'week' | 'month' | 'year' }
  rangeInterval?: MarketInterval | string
}

export type DataChartIndicatorRef = {
  id: string
  isCustom: boolean
}

export type DataChartWidgetParams = {
  provider?: string
  providerParams?: Record<string, unknown>
  listing?: ListingIdentity | null
  interval?: MarketInterval | string
  start?: string | number
  end?: string | number
  normalizationMode?: NormalizationMode | string
  dataWindow?: DataChartWindow
  live?: {
    enabled?: boolean
    interval?: MarketInterval | string
    stream?: string
  }
  chart?: {
    locale?: string
    timezone?: string
    pricePrecision?: number
    volumePrecision?: number
    candleType?: DataChartCandleType
    priceAxisType?: 'normal' | 'percentage' | 'log'
    indicators?: DataChartIndicatorRef[]
    stylesOverride?: Record<string, unknown>
  }
  refreshAt?: number
}
