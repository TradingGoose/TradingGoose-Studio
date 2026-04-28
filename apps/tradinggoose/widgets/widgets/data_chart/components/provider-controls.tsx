'use client'

import { RefreshCw } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { MarketProviderSettingsButton } from '@/widgets/widgets/components/market-provider-settings-button'
import {
  widgetHeaderButtonGroupClassName,
  widgetHeaderIconButtonClassName,
} from '@/widgets/widgets/components/widget-header-control'
import { providerOptions } from '@/widgets/widgets/data_chart/options'
import type {
  DataChartAuthParams,
  DataChartDataParams,
  DataChartWidgetParams,
} from '@/widgets/widgets/data_chart/types'

type DataChartProviderControlsProps = {
  widgetKey?: string
  panelId?: string
  workspaceId?: string
  params: DataChartWidgetParams
}

type ProviderSettingsButtonProps = {
  providerId?: string
  providerParams?: Record<string, unknown>
  authParams?: DataChartAuthParams
  dataParams?: DataChartDataParams
  panelId?: string
  widgetKey?: string
  workspaceId?: string
}

export const DataChartProviderSettingsButton = ({
  providerId,
  providerParams,
  authParams,
  dataParams,
  panelId,
  widgetKey,
  workspaceId,
}: ProviderSettingsButtonProps) => {
  return (
    <MarketProviderSettingsButton
      providerId={providerId}
      providerParams={providerParams}
      authParams={authParams}
      workspaceId={workspaceId}
      onSave={({ providerParams: nextProviderParams, auth }) => {
        const { ...nextDataBase } = (dataParams ?? {}) as Record<string, unknown>
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

type ProviderSelectorProps = {
  providerId?: string
  dataParams?: DataChartDataParams
  viewParams?: DataChartWidgetParams['view']
  panelId?: string
  widgetKey?: string
}

export const DataChartProviderSelector = ({
  providerId,
  dataParams,
  viewParams,
  panelId,
  widgetKey,
}: ProviderSelectorProps) => {
  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return

    const {
      window: _window,
      fallbackWindow: _fallbackWindow,
      auth: _auth,
      providerParams: _providerParams,
      ...nextDataBase
    } = (dataParams ?? {}) as Record<string, unknown>
    const nextData = { ...nextDataBase, provider: nextProvider }

    const { rangePresetId: _rangePresetId, ...nextView } = (viewParams ?? {}) as Record<
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
    <MarketProviderSelector
      value={providerId ?? ''}
      options={providerOptions}
      onChange={handleProviderChange}
    />
  )
}

type RefreshButtonProps = {
  providerId?: string
  panelId?: string
  widgetKey?: string
}

export const DataChartRefreshButton = ({ providerId, panelId, widgetKey }: RefreshButtonProps) => {
  if (!providerId) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type='button'
          className={widgetHeaderIconButtonClassName()}
          onClick={() =>
            emitDataChartParamsChange({
              params: { runtime: { refreshAt: Date.now() } },
              panelId,
              widgetKey,
            })
          }
        >
          <RefreshCw className='h-3.5 w-3.5' />
          <span className='sr-only'>Refresh data</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side='top'>Refresh data</TooltipContent>
    </Tooltip>
  )
}

export const DataChartProviderControls = ({
  widgetKey,
  panelId,
  workspaceId,
  params,
}: DataChartProviderControlsProps) => {
  const providerId = params.data?.provider
  const providerParams = params.data?.providerParams ?? {}
  const authParams = params.data?.auth

  return (
    <div className={widgetHeaderButtonGroupClassName()}>
      <DataChartProviderSettingsButton
        providerId={providerId}
        providerParams={providerParams}
        authParams={authParams}
        dataParams={params.data}
        panelId={panelId}
        widgetKey={widgetKey}
        workspaceId={workspaceId}
      />
      <DataChartProviderSelector
        providerId={providerId}
        dataParams={params.data}
        viewParams={params.view}
        panelId={panelId}
        widgetKey={widgetKey}
      />
      <DataChartRefreshButton providerId={providerId} panelId={panelId} widgetKey={widgetKey} />
    </div>
  )
}
