'use client'

import { useEffect, useMemo } from 'react'
import type { PairColor } from '@/widgets/pair-colors'
import type { DataChartWidgetParams } from '@/widgets/widgets/new_data_chart/types'
type SeriesWindow = ReturnType<
  typeof import('@/widgets/widgets/new_data_chart/series-window').resolveSeriesWindow
>

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
    const currentView = dataParams.view ?? {}
    const hasWindowParams =
      Object.prototype.hasOwnProperty.call(currentData as Record<string, unknown>, 'window') ||
      Object.prototype.hasOwnProperty.call(currentData as Record<string, unknown>, 'fallbackWindow')

    return (
      hasWindowParams ||
      (seriesWindow.interval && seriesWindow.interval !== currentData.interval) ||
      (seriesWindow.interval && seriesWindow.interval !== currentView.interval) ||
      !currentView.marketSession
    )
  }, [
    dataParams.data,
    dataParams.view,
    onWidgetParamsChange,
    providerId,
    seriesWindow.interval,
  ])

  useEffect(() => {
    if (!onWidgetParamsChange || !shouldPersistDefaults) return

    const nextData = { ...(dataParams.data ?? {}) } as Record<string, unknown>
    delete nextData.window
    delete nextData.fallbackWindow
    if (seriesWindow.interval) {
      nextData.interval = seriesWindow.interval
    }

    const nextView = { ...(dataParams.view ?? {}) } as Record<string, unknown>
    if (seriesWindow.interval) {
      nextView.interval = seriesWindow.interval
    } else {
      delete nextView.interval
    }
    if (!nextView.marketSession) {
      nextView.marketSession = 'regular'
    }

    const nextParams: DataChartWidgetParams = {
      ...(dataParams ?? {}),
      data: nextData as DataChartWidgetParams['data'],
      view: nextView as DataChartWidgetParams['view'],
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
    seriesWindow.interval,
    shouldPersistDefaults,
  ])
}
