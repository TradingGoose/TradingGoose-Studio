'use client'

import { ChartNoAxesCombined } from 'lucide-react'
import { heatmapWidgetContract } from '@/widgets/widgets/heatmap/contract'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { HeatmapWidgetBody } from '@/widgets/widgets/heatmap/components/body'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'

export const heatmapWidget: DashboardWidgetDefinition = {
  contract: heatmapWidgetContract,
  icon: ChartNoAxesCombined,
  component: (props) => <HeatmapWidgetBody {...props} />,
  renderHeader: renderHeatmapHeader,
}
