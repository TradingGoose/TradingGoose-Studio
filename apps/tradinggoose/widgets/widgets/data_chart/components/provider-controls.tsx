'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getMarketProviderParamDefinitions } from '@/providers/market/providers'
import { useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { MarketProviderSelector } from '@/widgets/widgets/components/market-provider-selector'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import { providerOptions } from '@/widgets/widgets/data_chart/constants'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'
import { coerceProviderParams } from '@/widgets/widgets/data_chart/utils'

type DataChartProviderControlsProps = {
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
  pairColor: PairColor
}

type ProviderSettingsButtonProps = {
  providerId?: string
  providerParams?: Record<string, unknown>
  panelId?: string
  widgetKey?: string
}

export const DataChartProviderSettingsButton = ({
  providerId,
  providerParams,
  panelId,
  widgetKey,
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

  useEffect(() => {
    if (!settingsOpen) return
    paramValuesRef.current = {}
  }, [settingsOpen])

  const handleSaveProviderParams = () => {
    if (!providerId) return
    const sanitized = coerceProviderParams(providerId, {
      ...(providerParams ?? {}),
      ...paramValuesRef.current,
    })
    emitDataChartParamsChange({
      params: {
        providerParams: sanitized ?? {},
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
            const savedValue =
              definition.id in (providerParams ?? {}) ? providerParams?.[definition.id] : undefined
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
                <Input
                  id={inputId}
                  type={isPassword ? 'password' : 'text'}
                  autoComplete={isPassword ? 'new-password' : 'off'}
                  onChange={(event) => handleParamChange(definition.id, event.target.value)}
                  placeholder={definition.placeholder}
                  defaultValue={inputValue}
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
  panelId?: string
  widgetKey?: string
  pairColor: PairColor
}

export const DataChartProviderSelector = ({
  providerId,
  panelId,
  widgetKey,
  pairColor,
}: ProviderSelectorProps) => {
  const setPairContext = useSetPairColorContext()

  const handleProviderChange = (nextProvider: string) => {
    if (!nextProvider || nextProvider === providerId) return

    if (pairColor !== 'gray') {
      setPairContext(pairColor, { listing: null })
    }

    emitDataChartParamsChange({
      params: {
        provider: nextProvider,
        listing: pairColor === 'gray' ? null : undefined,
        interval: undefined,
        start: undefined,
        end: undefined,
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
              params: { refreshAt: Date.now() },
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
  params,
  pairColor,
}: DataChartProviderControlsProps) => {
  const providerId = params.provider
  const providerParams = params.providerParams ?? {}

  return (
    <div className='flex items-center gap-2'>
      <DataChartProviderSettingsButton
        providerId={providerId}
        providerParams={providerParams}
        panelId={panelId}
        widgetKey={widgetKey}
      />
      <DataChartProviderSelector
        providerId={providerId}
        panelId={panelId}
        widgetKey={widgetKey}
        pairColor={pairColor}
      />
      <DataChartRefreshButton providerId={providerId} panelId={panelId} widgetKey={widgetKey} />
    </div>
  )
}
