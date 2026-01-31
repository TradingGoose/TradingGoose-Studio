import type { DataChartCandleType } from '@/widgets/widgets/new_data_chart/types'

export const resolveSeriesType = (candleType?: DataChartCandleType | string | null) => {
  if (candleType === 'area') return 'Area'
  if (candleType === 'ohlc') return 'Bar'
  return 'Candlestick'
}
