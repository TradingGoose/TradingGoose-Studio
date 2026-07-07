'use client'

import { useEffect, useMemo } from 'react'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/contract'
import { useDataChartParamsPatch } from '@/widgets/widgets/data_chart/hooks/use-data-chart-params-patch'

type SeriesWindow = ReturnType<
  typeof import('@/widgets/widgets/data_chart/series-window').resolveSeriesWindow
>

type UseChartDefaultsArgs = {
  dataParams: DataChartWidgetParams
  providerId?: string | null
  seriesWindow: SeriesWindow
  panelId?: string
  widgetKey?: string
}

export const useChartDefaults = ({
  dataParams,
  providerId,
  seriesWindow,
  panelId,
  widgetKey,
}: UseChartDefaultsArgs) => {
  const patchWidgetParams = useDataChartParamsPatch(panelId, widgetKey)
  const shouldPersistDefaults = useMemo(() => {
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
  }, [dataParams.data, dataParams.view, providerId, seriesWindow.interval])

  useEffect(() => {
    if (!shouldPersistDefaults) return

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

    patchWidgetParams(nextParams as Record<string, unknown>)
  }, [dataParams, patchWidgetParams, seriesWindow.interval, shouldPersistDefaults])
}
