import { getMarketProviderOptionsByKind } from '@/providers/market/providers'
import {
  AreaChartIcon,
  BarDownHollow,
  BarHollow,
  BarSolid,
  BarStroke,
  BarUpHollow,
} from '@/components/icons/icons'
import type { DataChartCandleType } from '@/widgets/widgets/data_chart/types'

export const getSeriesMarketProviderOptions = () => getMarketProviderOptionsByKind('series')

export const providerOptions = getSeriesMarketProviderOptions()

export const resolveSeriesMarketProviderId = (
  provider: unknown,
  options = getSeriesMarketProviderOptions()
) => {
  const providerId = typeof provider === 'string' ? provider.trim() : ''
  if (providerId && options.some((option) => option.id === providerId)) return providerId
  return options[0]?.id ?? ''
}

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
