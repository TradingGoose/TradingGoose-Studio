'use client'

import { useEffect, useMemo } from 'react'
import type { PairColor } from '@/widgets/pair-colors'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

type SeriesWindow = ReturnType<
  typeof import('@/widgets/widgets/data_chart/series-window').resolveSeriesWindow
>

type UseChartDefaultsArgs = {
  dataParams: DataChartWidgetParams
  providerId?: string | null
  seriesWindow: SeriesWindow
  onWidgetParamsChange?: (params: Record<string, unknown> | null) => void
  resolvedPairColor: PairColor
  panelId?: string
  widgetKey?: string
}

export const useChartDefaults = ({
  dataParams,
  providerId,
  seriesWindow,
  onWidgetParamsChange,
  resolvedPairColor,
  panelId,
  widgetKey,
}: UseChartDefaultsArgs) => {
  const shouldPersistDefaults = useMemo(() => {
    if (!onWidgetParamsChange) return false
    if (!providerId) return false
    const currentData = dataParams.data ?? {}
    const currentDataRecord = currentData as Record<string, unknown>
    const currentView = dataParams.view ?? {}
    const hasWindowParams =
      currentDataRecord.window != null || currentDataRecord.fallbackWindow != null

    return (
      hasWindowParams ||
      (seriesWindow.interval && seriesWindow.interval !== currentView.interval) ||
      !currentView.marketSession
    )
  }, [dataParams.data, dataParams.view, onWidgetParamsChange, providerId, seriesWindow.interval])

  useEffect(() => {
    if (!onWidgetParamsChange || !shouldPersistDefaults) return

    const {
      window: _window,
      fallbackWindow: _fallbackWindow,
      ...nextDataBase
    } = (dataParams.data ?? {}) as Record<string, unknown>
    const nextData = { ...nextDataBase }

    const viewBase = { ...(dataParams.view ?? {}) } as Record<string, unknown>
    const nextView = seriesWindow.interval
      ? { ...viewBase, interval: seriesWindow.interval }
      : (({ interval: _interval, ...rest }) => rest)(viewBase)
    if (!nextView.marketSession) {
      nextView.marketSession = 'regular'
    }

    const nextParams: DataChartWidgetParams = {
      data: nextData as DataChartWidgetParams['data'],
      view: nextView as DataChartWidgetParams['view'],
    }

    const nextPayload =
      resolvedPairColor !== 'gray'
        ? (({ listing: _listing, ...rest }) => rest)(nextParams)
        : nextParams

    emitDataChartParamsChange({
      params: nextPayload as Record<string, unknown>,
      panelId,
      widgetKey,
    })
  }, [
    dataParams,
    panelId,
    resolvedPairColor,
    seriesWindow.interval,
    shouldPersistDefaults,
    widgetKey,
  ])
}
