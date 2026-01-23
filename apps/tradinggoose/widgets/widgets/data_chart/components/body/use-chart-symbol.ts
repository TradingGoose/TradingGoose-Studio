'use client'

import { type MutableRefObject, useEffect } from 'react'
import type { Chart, Period } from 'klinecharts'
import { intervalToPeriod } from '@/widgets/widgets/data_chart/remapping'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

type UseChartSymbolArgs = {
  chartRef: MutableRefObject<Chart | null>
  listingKey: string | null
  chartSettings?: DataChartWidgetParams['chart']
  interval?: string | null
  tooltipTitle: string
}

export const useChartSymbol = ({
  chartRef,
  listingKey,
  chartSettings,
  interval,
  tooltipTitle,
}: UseChartSymbolArgs) => {
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const ticker = listingKey ?? 'Symbol'
    const settings = chartSettings ?? {}
    const pricePrecision = typeof settings.pricePrecision === 'number' ? settings.pricePrecision : 2
    const volumePrecision =
      typeof settings.volumePrecision === 'number' ? settings.volumePrecision : 0

    chart.setSymbol({
      ticker,
      pricePrecision,
      volumePrecision,
      display: tooltipTitle || ticker,
    })

    const period: Period = intervalToPeriod(interval) ?? ({ span: 1, type: 'day' } as Period)
    chart.setPeriod(period)
  }, [chartRef, chartSettings, interval, listingKey, tooltipTitle])
}
