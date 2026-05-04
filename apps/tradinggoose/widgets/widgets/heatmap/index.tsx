'use client'

import { ChartNoAxesCombined } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { HeatmapWidgetBody } from '@/widgets/widgets/heatmap/components/body'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'

export const heatmapWidget: DashboardWidgetDefinition = {
  key: 'heatmap',
  title: 'Heatmap',
  icon: ChartNoAxesCombined,
  category: 'trading',
  description: 'Watchlist or portfolio market move treemap.',
  component: (props) => <HeatmapWidgetBody {...props} />,
  renderHeader: renderHeatmapHeader,
}
