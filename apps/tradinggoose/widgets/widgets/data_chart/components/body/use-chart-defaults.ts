'use client'

import { useEffect, useMemo } from 'react'
import type { PairColor } from '@/widgets/pair-colors'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { parseDateInput, type resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'

type SeriesWindow = ReturnType<typeof resolveSeriesWindow>

type UseChartDefaultsArgs = {
  dataParams: DataChartWidgetParams
  providerId?: string | null
  seriesWindow: SeriesWindow
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  resolvedPairColor: PairColor
}

export const useChartDefaults = ({
  dataParams,
  providerId,
  seriesWindow,
  onWidgetParamsChange,
  resolvedPairColor,
}: UseChartDefaultsArgs) => {
  const shouldPersistDefaults = useMemo(() => {
    if (!onWidgetParamsChange) return false
    if (!providerId) return false
    if (!seriesWindow.startDate || !seriesWindow.endDate) return false
    const currentStart = parseDateInput(dataParams.start)
    const currentEnd = parseDateInput(dataParams.end)
    const nextStart = seriesWindow.startDate.toISOString()
    const nextEnd = seriesWindow.endDate.toISOString()

    const windowChanged =
      JSON.stringify(dataParams.dataWindow ?? {}) !== JSON.stringify(seriesWindow.dataWindow ?? {})

    return (
      windowChanged ||
      !currentStart ||
      currentStart.toISOString() !== nextStart ||
      !currentEnd ||
      currentEnd.toISOString() !== nextEnd ||
      (seriesWindow.interval && seriesWindow.interval !== dataParams.interval)
    )
  }, [
    dataParams.dataWindow,
    dataParams.end,
    dataParams.interval,
    dataParams.start,
    onWidgetParamsChange,
    providerId,
    seriesWindow.dataWindow,
    seriesWindow.endDate,
    seriesWindow.interval,
    seriesWindow.startDate,
  ])

  useEffect(() => {
    if (!onWidgetParamsChange || !shouldPersistDefaults) return

    const nextParams: DataChartWidgetParams = {
      ...(dataParams ?? {}),
      interval: seriesWindow.interval,
      start: seriesWindow.startDate?.toISOString(),
      end: seriesWindow.endDate?.toISOString(),
      dataWindow: seriesWindow.dataWindow,
    }

    const nextPayload =
      resolvedPairColor !== 'gray'
        ? (({ listing: _listing, ...rest }) => rest)(nextParams)
        : nextParams

    onWidgetParamsChange(nextPayload as Record<string, unknown>)
  }, [
    dataParams,
    onWidgetParamsChange,
    resolvedPairColor,
    seriesWindow.dataWindow,
    seriesWindow.endDate,
    seriesWindow.interval,
    seriesWindow.startDate,
    shouldPersistDefaults,
  ])
}
