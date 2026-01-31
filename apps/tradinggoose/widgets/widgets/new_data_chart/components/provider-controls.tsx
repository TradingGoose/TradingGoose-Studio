'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { getMarketProviderParamDefinitions } from '@/providers/market/providers'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { ShortInput } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/short-input'
import { providerOptions } from '@/widgets/widgets/new_data_chart/options'
import type {
  DataChartAuthParams,
  DataChartDataParams,
  DataChartWidgetParams,
} from '@/widgets/widgets/new_data_chart/types'
import { coerceProviderParams } from '@/widgets/widgets/new_data_chart/series-window'

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
  const paramDefinitions = useMemo(() => {
    if (!providerId) return []
    return getMarketProviderParamDefinitions(providerId, 'series').filter(
      (definition) =>
        definition.required &&
        definition.visibility !== 'hidden' &&
        definition.visibility !== 'llm-only'
    )
  }, [providerId])

  const [settingsOpen, setSettingsOpen] = useState(false)
  const paramValuesRef = useRef<Record<string, unknown>>({})
  const [inputValues, setInputValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!settingsOpen) return
    paramValuesRef.current = {}
    setInputValues({})
  }, [settingsOpen])

  const handleSaveProviderParams = () => {
    if (!providerId) return
    const nextProviderParamsInput = {
      ...(providerParams ?? {}),
      ...paramValuesRef.current,
    } as Record<string, unknown>
    delete nextProviderParamsInput.apiKey
    delete nextProviderParamsInput.apiSecret
    const sanitized = coerceProviderParams(providerId, nextProviderParamsInput)
    const nextProviderParams =
      sanitized && Object.keys(sanitized).length > 0 ? sanitized : undefined
    const nextAuth: DataChartAuthParams | undefined = (() => {
      const apiKey =
        (paramValuesRef.current.apiKey as string | undefined) ?? authParams?.apiKey
      const apiSecret =
        (paramValuesRef.current.apiSecret as string | undefined) ?? authParams?.apiSecret
      return apiKey || apiSecret ? { apiKey, apiSecret } : undefined
    })()
    emitDataChartParamsChange({
      params: {
        data: {
          ...(dataParams ?? {}),
          providerParams: nextProviderParams,
          auth: nextAuth,
        },
      },
      panelId,
      widgetKey,
    })
    setSettingsOpen(false)
  }

  const hasRequiredParams = paramDefinitions.length > 0
  const handleParamChange = (id: string, value: unknown) => {
    if (typeof value === 'string' && value.trim() === '') {
      delete paramValuesRef.current[id]
      return
    }
    paramValuesRef.current[id] = value
  }

  if (!hasRequiredParams) return null

  return (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              disabled={!providerId}
            >
              <KeyRound className='h-3.5 w-3.5' />
              <span className='sr-only'>Provider settings</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>Provider settings</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-72 space-y-3 p-4'>
        <div className='space-y-1'>
          <p className='font-medium text-sm'>Provider settings</p>
          <p className='text-muted-foreground text-xs'>Save credentials for this widget.</p>
        </div>
        <div className='space-y-3'>
          {paramDefinitions.map((definition) => {
            const inputId = `provider-param-${providerId ?? 'unknown'}-${definition.id}`
            const isPassword = definition.password || definition.id.toLowerCase().includes('secret')
            const isAuthField = definition.id === 'apiKey' || definition.id === 'apiSecret'
            const savedValue = isAuthField
              ? authParams?.[definition.id]
              : providerParams?.[definition.id]
            const resolvedValue = savedValue ?? definition.defaultValue
            const selectValue =
              typeof resolvedValue === 'string' || typeof resolvedValue === 'number'
                ? String(resolvedValue)
                : undefined
            const inputValue =
              typeof resolvedValue === 'string' || typeof resolvedValue === 'number'
                ? String(resolvedValue)
                : typeof resolvedValue === 'object' && resolvedValue !== null
                  ? JSON.stringify(resolvedValue)
                  : undefined
            const booleanValue =
              typeof resolvedValue === 'boolean'
                ? resolvedValue
                : typeof resolvedValue === 'string'
                  ? resolvedValue.toLowerCase() === 'true'
                  : false
            const controlledValue = inputValues[definition.id] ?? (inputValue ?? '')
            const shortInputConfig: SubBlockConfig = {
              id: definition.id,
              title: definition.title ?? definition.id,
              type: 'short-input',
              inputType: definition.type === 'number' ? 'number' : 'text',
              placeholder: definition.placeholder,
              min: definition.min,
              max: definition.max,
              step: definition.step,
              integer: definition.integer,
              connectionDroppable: false,
            }

            if (definition.inputType === 'switch' || definition.type === 'boolean') {
              return (
                <div
                  key={`${providerId ?? 'unknown'}-${definition.id}`}
                  className='flex items-center justify-between gap-2'
                >
                  <Label htmlFor={inputId} className='text-xs'>
                    {definition.title ?? definition.id}
                  </Label>
                  <Switch
                    id={inputId}
                    defaultChecked={booleanValue}
                    onCheckedChange={(checked) => handleParamChange(definition.id, checked)}
                  />
                </div>
              )
            }

            if (definition.options?.length) {
              return (
                <div key={`${providerId ?? 'unknown'}-${definition.id}`} className='space-y-1'>
                  <Label htmlFor={inputId} className='text-xs'>
                    {definition.title ?? definition.id}
                  </Label>
                  <Select
                    defaultValue={selectValue}
                    onValueChange={(nextValue) => handleParamChange(definition.id, nextValue)}
                  >
                    <SelectTrigger id={inputId}>
                      <SelectValue placeholder={definition.placeholder ?? 'Select'} />
                    </SelectTrigger>
                    <SelectContent>
                      {definition.options.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )
            }

            return (
              <div key={`${providerId ?? 'unknown'}-${definition.id}`} className='space-y-1'>
                <Label htmlFor={inputId} className='text-xs'>
                  {definition.title ?? definition.id}
                </Label>
                <ShortInput
                  blockId={`provider-${providerId ?? 'unknown'}`}
                  subBlockId={definition.id}
                  inputId={inputId}
                  isConnecting={false}
                  config={shortInputConfig}
                  value={controlledValue}
                  onChange={(value) => {
                    setInputValues((current) => ({ ...current, [definition.id]: value }))
                    handleParamChange(definition.id, value)
                  }}
                  placeholder={definition.placeholder}
                  password={isPassword}
                  workspaceId={workspaceId}
                  enableTags={false}
                />
              </div>
            )
          })}
        </div>
        <div className='flex justify-end gap-2'>
          <Button size='sm' variant='outline' onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button size='sm' onClick={handleSaveProviderParams}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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

    const nextData = { ...(dataParams ?? {}) } as Record<string, unknown>
    delete nextData.window
    delete nextData.fallbackWindow
    nextData.provider = nextProvider

    const nextView = { ...(viewParams ?? {}) } as Record<string, unknown>
    delete nextView.rangePresetId

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
    <div className='flex items-center gap-2'>
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
