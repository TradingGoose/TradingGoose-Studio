'use client'

import type { DashboardWidgetDefinition } from '@/widgets/types'
import type { PairColor } from '@/widgets/pair-colors'
import { DataChartProviderControls } from '@/widgets/widgets/data_chart/components/provider-controls'
import { DataChartListingControl } from '@/widgets/widgets/data_chart/components/listing-control'
import { DataChartChartControls } from '@/widgets/widgets/data_chart/components/chart-controls'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { resolveSeriesWindow } from '@/widgets/widgets/data_chart/utils'

export const renderDataChartHeader: DashboardWidgetDefinition['renderHeader'] = ({
  widget,
  context,
  panelId,
}) => {
  const dataParams =
    widget?.params && typeof widget.params === 'object'
      ? (widget.params as DataChartWidgetParams)
      : {}
  const resolvedPairColor = (widget?.pairColor ?? 'gray') as PairColor
  const seriesWindow = resolveSeriesWindow(dataParams, dataParams.data?.provider)

  return {
    left: (
      <DataChartProviderControls
        widgetKey={widget?.key}
        panelId={panelId}
        workspaceId={context?.workspaceId}
        params={dataParams}
      />
    ),
    center: (
      <DataChartListingControl
        widgetKey={widget?.key}
        panelId={panelId}
        params={dataParams}
        pairColor={resolvedPairColor}
      />
    ),
    right: (
      <DataChartChartControls
        workspaceId={context?.workspaceId}
        widgetKey={widget?.key}
        panelId={panelId}
        params={dataParams}
        interval={seriesWindow.interval}
        allowedIntervals={seriesWindow.allowedIntervals}
        supportsInterval={seriesWindow.supportsInterval}
      />
    ),
  }
}
