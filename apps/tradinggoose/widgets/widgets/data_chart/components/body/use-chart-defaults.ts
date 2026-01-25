'use client'

import { useEffect, useMemo } from 'react'
import type { PairColor } from '@/widgets/pair-colors'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { type resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'

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
    const currentData = dataParams.data ?? {}
    const windowChanged =
      JSON.stringify(currentData.window ?? {}) !== JSON.stringify(seriesWindow.window ?? {})
    const fallbackChanged =
      JSON.stringify(currentData.fallbackWindow ?? {}) !==
      JSON.stringify(seriesWindow.fallbackWindow ?? {})

    return (
      windowChanged ||
      fallbackChanged ||
      (seriesWindow.interval && seriesWindow.interval !== currentData.interval)
    )
  }, [
    dataParams.data,
    onWidgetParamsChange,
    providerId,
    seriesWindow.fallbackWindow,
    seriesWindow.interval,
    seriesWindow.window,
  ])

  useEffect(() => {
    if (!onWidgetParamsChange || !shouldPersistDefaults) return

    const nextParams: DataChartWidgetParams = {
      ...(dataParams ?? {}),
      data: {
        ...(dataParams.data ?? {}),
        interval: seriesWindow.interval,
        window: seriesWindow.window ?? undefined,
        fallbackWindow: seriesWindow.fallbackWindow ?? undefined,
      },
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
    seriesWindow.fallbackWindow,
    seriesWindow.interval,
    seriesWindow.window,
    shouldPersistDefaults,
  ])
}
