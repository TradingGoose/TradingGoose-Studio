'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import {
  getMarketProviderParamDefinitions,
  type MarketProviderParamDefinition,
} from '@/providers/market/providers'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'
import { ShortInput } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/short-input'
import { coerceProviderParams } from '@/widgets/widgets/data_chart/series-window'
import type { WatchlistWidgetParams } from '@/widgets/widgets/watchlist/types'

type ProviderSettingsSaveResult = {
  auth?: Record<string, unknown>
  providerParams?: Record<string, unknown>
}

type WatchlistProviderSettingsButtonProps = {
  providerId?: string
  providerParams?: Record<string, unknown>
  authParams?: WatchlistWidgetParams['auth']
  definitions: MarketProviderParamDefinition[]
  workspaceId?: string
  onSave: (next: ProviderSettingsSaveResult) => void
}

const resolveSavedValue = ({
  definition,
  authParams,
  providerParams,
}: {
  definition: MarketProviderParamDefinition
  authParams?: Record<string, unknown>
  providerParams?: Record<string, unknown>
}) => {
  if (definition.id === 'apiKey' || definition.id === 'apiSecret') {
    return authParams?.[definition.id]
  }

  return providerParams?.[definition.id]
}

const isCredentialDefinition = (definition: MarketProviderParamDefinition) => {
  if (definition.visibility === 'hidden' || definition.visibility === 'llm-only') {
    return false
  }

  return (
    definition.password === true ||
    definition.id === 'apiKey' ||
    definition.id === 'apiSecret'
  )
}

export const resolveWatchlistProviderCredentialDefinitions = (providerId?: string) => {
  if (!providerId) return []
  return getMarketProviderParamDefinitions(providerId, 'series').filter(isCredentialDefinition)
}

export const WatchlistProviderSettingsButton = ({
  providerId,
  providerParams,
  authParams,
  definitions,
  workspaceId,
  onSave,
}: WatchlistProviderSettingsButtonProps) => {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const paramValuesRef = useRef<Record<string, unknown>>({})
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const hasDefinitions = definitions.length > 0

  useEffect(() => {
    if (!settingsOpen) return
    paramValuesRef.current = {}
    setInputValues({})
  }, [settingsOpen])

  const handleParamChange = (id: string, value: unknown) => {
    if (typeof value === 'string' && value.trim() === '') {
      delete paramValuesRef.current[id]
      return
    }
    paramValuesRef.current[id] = value
  }

  const handleSaveProviderParams = () => {
    if (!providerId) return

    const nextProviderParamsInput = {
      ...(providerParams ?? {}),
      ...paramValuesRef.current,
    } as Record<string, unknown>

    delete nextProviderParamsInput.apiKey
    delete nextProviderParamsInput.apiSecret

    const nextProviderParams = coerceProviderParams(providerId, nextProviderParamsInput)
    const nextAuth: Record<string, unknown> = {}

    const apiKey = paramValuesRef.current.apiKey ?? authParams?.apiKey
    const apiSecret = paramValuesRef.current.apiSecret ?? authParams?.apiSecret

    if (apiKey !== undefined && apiKey !== null && apiKey !== '') {
      nextAuth.apiKey = apiKey
    }
    if (apiSecret !== undefined && apiSecret !== null && apiSecret !== '') {
      nextAuth.apiSecret = apiSecret
    }

    onSave({
      providerParams: nextProviderParams,
      auth: Object.keys(nextAuth).length > 0 ? nextAuth : undefined,
    })
    setSettingsOpen(false)
  }

  if (!hasDefinitions) return null

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
          {definitions.map((definition) => {
            const inputId = `provider-param-${providerId ?? 'unknown'}-${definition.id}`
            const isPassword = definition.password || definition.id.toLowerCase().includes('secret')
            const resolvedValue =
              resolveSavedValue({
                definition,
                authParams,
                providerParams,
              }) ?? definition.defaultValue
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
