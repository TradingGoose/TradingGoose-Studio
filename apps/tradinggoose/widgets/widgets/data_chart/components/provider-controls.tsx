'use client'

import { MarketProviderControls } from '@/components/market-selector/provider-controls'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/contract'
import { useDataChartCopy } from '@/widgets/widgets/data_chart/copy'
import { useDataChartParamsPatch } from '@/widgets/widgets/data_chart/hooks/use-data-chart-params-patch'
import { providerOptions } from '@/widgets/widgets/data_chart/options'

type DataChartProviderControlsProps = {
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
  workspaceId?: string
}

type RefreshButtonProps = {
  providerId?: string
  panelId?: string
  widgetKey?: string
}

export const DataChartRefreshControl = ({ providerId, panelId, widgetKey }: RefreshButtonProps) => {
  const copy = useDataChartCopy().header
  const patchWidgetParams = useDataChartParamsPatch()
  return (
    <WidgetHeaderRefreshButton
      label={copy.refresh}
      disabled={!providerId}
      onClick={() => {
        if (!providerId) return
        patchWidgetParams({ runtime: { refreshAt: Date.now() } })
      }}
    />
  )
}

export const DataChartProviderControls = ({
  widgetKey,
  panelId,
  params,
  workspaceId,
}: DataChartProviderControlsProps) => {
  const providerId = params.data?.provider
  const providerParams = params.data?.providerParams ?? {}
  const authParams = params.data?.auth
  const patchWidgetParams = useDataChartParamsPatch()
  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return

    const {
      window: _window,
      fallbackWindow: _fallbackWindow,
      auth: _auth,
      providerParams: _providerParams,
      ...nextDataBase
    } = (params.data ?? {}) as Record<string, unknown>
    const nextData = { ...nextDataBase, provider: nextProvider }

    const { rangePresetId: _rangePresetId, ...nextView } = (params.view ?? {}) as Record<
      string,
      unknown
    >

    patchWidgetParams({
      data: nextData,
      view: nextView,
    })
  }

  return (
    <MarketProviderControls
      value={providerId}
      options={providerOptions}
      onChange={handleProviderChange}
      providerParams={providerParams}
      authParams={authParams}
      workspaceId={workspaceId}
      onSettingsSave={({ providerParams: nextProviderParams, auth }) => {
        const { ...nextDataBase } = (params.data ?? {}) as Record<string, unknown>
        patchWidgetParams({
          data: {
            ...nextDataBase,
            providerParams: nextProviderParams,
            auth,
          },
        })
      }}
    />
  )
}
