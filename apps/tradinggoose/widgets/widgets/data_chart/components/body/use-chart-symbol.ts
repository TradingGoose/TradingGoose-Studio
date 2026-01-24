'use client'

import { type MutableRefObject, useEffect } from 'react'
import type { Chart, Period } from 'klinecharts'
import { intervalToPeriod } from '@/widgets/widgets/data_chart/remapping'
type UseChartSymbolArgs = {
  chartRef: MutableRefObject<Chart | null>
  listingKey: string | null
  pricePrecision?: number
  volumePrecision?: number
  interval?: string | null
  tooltipTitle: string
}

export const useChartSymbol = ({
  chartRef,
  listingKey,
  pricePrecision,
  volumePrecision,
  interval,
  tooltipTitle,
}: UseChartSymbolArgs) => {
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    const ticker = listingKey ?? 'Symbol'
    const resolvedPricePrecision =
      typeof pricePrecision === 'number' ? pricePrecision : 2
    const resolvedVolumePrecision =
      typeof volumePrecision === 'number' ? volumePrecision : 0

    chart.setSymbol({
      ticker,
      pricePrecision: resolvedPricePrecision,
      volumePrecision: resolvedVolumePrecision,
      display: tooltipTitle || ticker,
    })

    const period: Period = intervalToPeriod(interval) ?? ({ span: 1, type: 'day' } as Period)
    chart.setPeriod(period)
  }, [chartRef, interval, listingKey, pricePrecision, tooltipTitle, volumePrecision])
}
