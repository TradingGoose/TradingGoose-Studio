'use client'

import type { PairColor } from '@/widgets/pair-colors'
import type { DashboardWidgetDefinition } from '@/widgets/types'
import { DataChartChartControls } from '@/widgets/widgets/data_chart/components/chart-controls'
import { DataChartListingControl } from '@/widgets/widgets/data_chart/components/listing-control'
import {
  DataChartProviderControls,
  DataChartRefreshControl,
} from '@/widgets/widgets/data_chart/components/provider-controls'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/series-window'
import type {
  DataChartWidgetParams,
  dataChartWidgetParams,
} from '@/widgets/widgets/data_chart/types'

export const renderDataChartHeader: DashboardWidgetDefinition['renderHeader'] = ({
  widget,
  context,
  panelId,
}) => {
  const widgetKey = widget?.key ?? 'data_chart'
  const dataParams =
    widget?.params && typeof widget.params === 'object'
      ? (widget.params as dataChartWidgetParams)
      : {}
  const resolvedPairColor = (widget?.pairColor ?? 'gray') as PairColor
  const seriesWindow = resolveSeriesWindow(dataParams, dataParams.data?.provider)

  return {
    left: (
      <DataChartProviderControls
        widgetKey={widgetKey}
        panelId={panelId}
        params={dataParams as DataChartWidgetParams}
      />
    ),
    center: (
      <DataChartListingControl
        widgetKey={widgetKey}
        panelId={panelId}
        params={dataParams as DataChartWidgetParams}
        pairColor={resolvedPairColor}
      />
    ),
    right: (
      <>
        <DataChartChartControls
          workspaceId={context?.workspaceId}
          params={dataParams as DataChartWidgetParams}
          interval={seriesWindow.interval}
          allowedIntervals={seriesWindow.allowedIntervals}
          supportsInterval={seriesWindow.supportsInterval}
          panelId={panelId}
          widgetKey={widgetKey}
        />
        <DataChartRefreshControl
          providerId={dataParams.data?.provider}
          panelId={panelId}
          widgetKey={widgetKey}
        />
      </>
    ),
  }
}
