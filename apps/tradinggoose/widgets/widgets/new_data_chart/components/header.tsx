'use client'

import type { DashboardWidgetDefinition } from '@/widgets/types'
import type { PairColor } from '@/widgets/pair-colors'
import { DataChartProviderControls } from '@/widgets/widgets/new_data_chart/components/provider-controls'
import { DataChartListingControl } from '@/widgets/widgets/new_data_chart/components/listing-control'
import { DataChartChartControls } from '@/widgets/widgets/new_data_chart/components/chart-controls'
import type { DataChartWidgetParams, NewDataChartWidgetParams } from '@/widgets/widgets/new_data_chart/types'
import { resolveSeriesWindow } from '@/widgets/widgets/new_data_chart/series-window'

export const renderNewDataChartHeader: DashboardWidgetDefinition['renderHeader'] = ({
  widget,
  context,
  panelId,
}) => {
  const widgetKey = widget?.key ?? 'new_data_chart'
  const dataParams =
    widget?.params && typeof widget.params === 'object'
      ? (widget.params as NewDataChartWidgetParams)
      : {}
  const resolvedPairColor = (widget?.pairColor ?? 'gray') as PairColor
  const seriesWindow = resolveSeriesWindow(dataParams, dataParams.data?.provider)

  return {
    left: (
      <DataChartProviderControls
        widgetKey={widgetKey}
        panelId={panelId}
        workspaceId={context?.workspaceId}
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
      <DataChartChartControls
        workspaceId={context?.workspaceId}
        params={dataParams as DataChartWidgetParams}
        interval={seriesWindow.interval}
        allowedIntervals={seriesWindow.allowedIntervals}
        supportsInterval={seriesWindow.supportsInterval}
        panelId={panelId}
        widgetKey={widgetKey}
      />
    ),
  }
}
