import {
  AreaChartIcon,
  BarDownHollow,
  BarHollow,
  BarSolid,
  BarStroke,
  BarUpHollow,
} from '@/components/icons/icons'
import { getMarketProviderOptionsByKind } from '@/providers/market/providers'
import type { DataChartCandleType } from '@/widgets/widgets/data_chart/contract'

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

export const resolveConfiguredSeriesMarketProviderId = (
  provider: unknown,
  options = getSeriesMarketProviderOptions()
) => {
  const providerId = typeof provider === 'string' ? provider.trim() : ''
  return providerId && options.some((option) => option.id === providerId) ? providerId : ''
}

export const CANDLE_TYPE_OPTIONS: Array<{
  id: DataChartCandleType
  icon: typeof BarSolid
}> = [
  { id: 'candle_solid', icon: BarSolid },
  { id: 'candle_stroke', icon: BarHollow },
  { id: 'candle_up_stroke', icon: BarUpHollow },
  { id: 'candle_down_stroke', icon: BarDownHollow },
  { id: 'ohlc', icon: BarStroke },
  { id: 'area', icon: AreaChartIcon },
]
