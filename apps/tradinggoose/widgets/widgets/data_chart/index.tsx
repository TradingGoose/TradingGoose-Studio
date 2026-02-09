'use client'

import { CandlestickChart } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { DataChartWidgetBody } from '@/widgets/widgets/data_chart/components/chart-body'
import { renderDataChartHeader } from '@/widgets/widgets/data_chart/components/header'

export const dataChartWidget: DashboardWidgetDefinition = {
  key: 'data_chart',
  title: 'Data Chart',
  icon: CandlestickChart,
  category: 'utility',
  description: 'Visualize OHLCV market data.',
  component: (props) => <DataChartWidgetBody {...props} />,
  renderHeader: renderDataChartHeader,
}
