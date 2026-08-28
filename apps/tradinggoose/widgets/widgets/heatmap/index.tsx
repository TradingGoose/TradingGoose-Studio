'use client'

import { ChartNoAxesCombined } from 'lucide-react'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { HeatmapWidgetBody } from '@/widgets/widgets/heatmap/components/body'
import { renderHeatmapHeader } from '@/widgets/widgets/heatmap/components/header'
import { heatmapWidgetContract } from '@/widgets/widgets/heatmap/contract'

export const heatmapWidget: DashboardWidgetDefinition = {
  contract: heatmapWidgetContract,
  icon: ChartNoAxesCombined,
  component: (props) => <HeatmapWidgetBody {...props} />,
  renderHeader: renderHeatmapHeader,
}
