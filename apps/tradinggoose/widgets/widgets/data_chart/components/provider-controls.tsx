'use client'

import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { MarketProviderControls } from '@/widgets/widgets/components/market-provider-controls'
import { WidgetHeaderRefreshButton } from '@/widgets/widgets/components/widget-header-refresh-button'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

type DataChartProviderControlsProps = {
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
}

type RefreshButtonProps = {
  providerId?: string
  panelId?: string
  widgetKey?: string
}

export const DataChartRefreshControl = ({ providerId, panelId, widgetKey }: RefreshButtonProps) => {
  return (
    <WidgetHeaderRefreshButton
      disabled={!providerId}
      onClick={() => {
        if (!providerId) return
        emitDataChartParamsChange({
          params: { runtime: { refreshAt: Date.now() } },
          panelId,
          widgetKey,
        })
      }}
    />
  )
}

export const DataChartProviderControls = ({
  widgetKey,
  panelId,
  params,
}: DataChartProviderControlsProps) => {
  const providerId = params.data?.provider
  const providerParams = params.data?.providerParams ?? {}
  const authParams = params.data?.auth
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

    emitDataChartParamsChange({
      params: {
        data: nextData,
        view: nextView,
      },
      panelId,
      widgetKey,
    })
  }

  return (
    <MarketProviderControls
      value={providerId}
      options={providerOptions}
      onChange={handleProviderChange}
      providerParams={providerParams}
      authParams={authParams}
      onSettingsSave={({ providerParams: nextProviderParams, auth }) => {
        const { ...nextDataBase } = (params.data ?? {}) as Record<string, unknown>
        emitDataChartParamsChange({
          params: {
            data: {
              ...nextDataBase,
              providerParams: nextProviderParams,
              auth,
            },
          },
          panelId,
          widgetKey,
        })
      }}
    />
  )
}
