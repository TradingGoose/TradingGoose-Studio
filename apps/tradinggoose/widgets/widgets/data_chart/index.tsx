'use client'

import { CandlestickChart } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { DataChartWidgetBody } from '@/widgets/widgets/data_chart/components/chart-body'
import { renderDataChartHeader } from '@/widgets/widgets/data_chart/components/header'
import { dataChartWidgetContract } from '@/widgets/widgets/data_chart/contract'

export const dataChartWidget: DashboardWidgetDefinition = {
  contract: dataChartWidgetContract,
  icon: CandlestickChart,
  component: (props) => <DataChartWidgetBody {...props} />,
  renderHeader: renderDataChartHeader,
}
