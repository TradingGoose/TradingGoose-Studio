'use client'

import { type MutableRefObject, useEffect } from 'react'
import type { Chart } from 'klinecharts'
import {
  applyChartStyles,
  resetChartTooltipTitle,
} from '@/widgets/widgets/data_chart/components/chart-styles'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

type UseChartStylesArgs = {
  chartRef: MutableRefObject<Chart | null>
  chartContainerRef: MutableRefObject<HTMLDivElement | null>
  chartSettings?: DataChartWidgetParams['chart']
  seriesTimezone: string | null
  themeVersion: number
  hasCustomTooltipTitleOverride: boolean
}

export const useChartStyles = ({
  chartRef,
  chartContainerRef,
  chartSettings,
  seriesTimezone,
  themeVersion,
  hasCustomTooltipTitleOverride,
}: UseChartStylesArgs) => {
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    applyChartStyles({
      chart,
      chartContainer: chartContainerRef.current,
      chartSettings,
      seriesTimezone,
    })
  }, [chartContainerRef, chartRef, chartSettings, seriesTimezone, themeVersion])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    if (hasCustomTooltipTitleOverride) return
    resetChartTooltipTitle(chart)
  }, [chartRef, hasCustomTooltipTitleOverride])
}
