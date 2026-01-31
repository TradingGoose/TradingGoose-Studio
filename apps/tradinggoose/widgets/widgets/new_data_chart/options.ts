import { getMarketProviderOptionsByKind } from '@/providers/market/providers'
import {
  AreaChartIcon,
  BarDownHollow,
  BarHollow,
  BarSolid,
  BarStroke,
  BarUpHollow,
} from '@/components/icons/icons'
import type { DataChartCandleType } from '@/widgets/widgets/new_data_chart/types'

export const providerOptions = getMarketProviderOptionsByKind('series')

export const CANDLE_TYPE_OPTIONS: Array<{
  id: DataChartCandleType
  label: string
  icon: typeof BarSolid
}> = [
  { id: 'candle_solid', label: 'Solid', icon: BarSolid },
  { id: 'candle_stroke', label: 'Hollow', icon: BarHollow },
  { id: 'candle_up_stroke', label: 'Up Hollow', icon: BarUpHollow },
  { id: 'candle_down_stroke', label: 'Down Hollow', icon: BarDownHollow },
  { id: 'ohlc', label: 'Bar Stroke', icon: BarStroke },
  { id: 'area', label: 'Area', icon: AreaChartIcon },
]
