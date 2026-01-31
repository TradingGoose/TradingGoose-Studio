'use client'

import { CandlestickChart } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { NewDataChartWidgetBody } from '@/widgets/widgets/new_data_chart/components/chart-body'
import { renderNewDataChartHeader } from '@/widgets/widgets/new_data_chart/components/header'

export const newDataChartWidget: DashboardWidgetDefinition = {
  key: 'new_data_chart',
  title: 'New Data Chart',
  icon: CandlestickChart,
  category: 'utility',
  description: 'Parallel LWC chart (migration path).',
  component: (props) => <NewDataChartWidgetBody {...props} />,
  renderHeader: renderNewDataChartHeader,
}
