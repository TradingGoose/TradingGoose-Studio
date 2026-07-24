'use client'

import type { DashboardWidgetDefinition } from '@/widgets/types'
import { DataChartChartControls } from '@/widgets/widgets/data_chart/components/chart-controls'
import { DataChartListingControl } from '@/widgets/widgets/data_chart/components/listing-control'
import {
  DataChartProviderControls,
  DataChartRefreshControl,
} from '@/widgets/widgets/data_chart/components/provider-controls'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/contract'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/series-window'

export const renderDataChartHeader: DashboardWidgetDefinition['renderHeader'] = ({
  widget,
  context,
  panelId,
}) => {
  const widgetKey = widget?.key ?? 'data_chart'
  const dataParams =
    widget?.params && typeof widget.params === 'object'
      ? (widget.params as DataChartWidgetParams)
      : {}
  const seriesWindow = resolveSeriesWindow(dataParams, dataParams.data?.provider)

  return {
    left: (
      <DataChartProviderControls
        widgetKey={widgetKey}
        panelId={panelId}
        params={dataParams as DataChartWidgetParams}
        workspaceId={context?.workspaceId}
      />
    ),
    center: (
      <DataChartListingControl
        widgetKey={widgetKey}
        panelId={panelId}
        params={dataParams as DataChartWidgetParams}
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
