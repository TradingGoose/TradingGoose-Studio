'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  isFullEnvVarReference,
  isMarketProviderCredentialDefinition,
  resolveMarketProviderSettingsDefinitions,
  sanitizeMarketProviderAuthRefs,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import { widgetHeaderIconButtonClassName } from '@/widgets/widgets/components/widget-header-control'

export type MarketProviderSettingsSaveResult = {
  auth?: Record<string, unknown>
  providerParams?: Record<string, unknown>
}

type MarketProviderSettingsButtonProps = {
  providerId?: string | null
  providerParams?: Record<string, unknown>
  authParams?: Record<string, unknown>
  workspaceId?: string
  onSave: (next: MarketProviderSettingsSaveResult) => void
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

export function MarketProviderSettingsButton({
  providerId,
  providerParams,
  authParams,
  onSave,
}: MarketProviderSettingsButtonProps) {
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const definitions = resolveMarketProviderSettingsDefinitions(trimmedProviderId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const paramValuesRef = useRef<Record<string, unknown>>({})
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!settingsOpen) return
    paramValuesRef.current = {}
    setInputValues({})
    setValidationErrors({})
  }, [settingsOpen])

  if (definitions.length === 0) return null

  const handleParamChange = (id: string, value: unknown) => {
    setValidationErrors((current) => {
      if (!current[id]) return current
      const next = { ...current }
      delete next[id]
      return next
    })

    if (typeof value === 'string' && value.trim() === '') {
      delete paramValuesRef.current[id]
      return
    }
    paramValuesRef.current[id] = value
  }

  const handleSave = () => {
    if (!trimmedProviderId) return

    const nextValidationErrors: Record<string, string> = {}
    for (const definition of definitions) {
      if (!isMarketProviderCredentialDefinition(definition)) continue

      const value = Object.hasOwn(paramValuesRef.current, definition.id)
        ? paramValuesRef.current[definition.id]
        : resolveSavedValue({ definition, authParams, providerParams })

      if (typeof value === 'string' && value.trim() && !isFullEnvVarReference(value)) {
        nextValidationErrors[definition.id] =
          'Use a full environment variable reference like {{ ALPACA_API_KEY }}.'
      }
    }

    if (Object.keys(nextValidationErrors).length > 0) {
      setValidationErrors(nextValidationErrors)
      return
    }

    const nextProviderParamsInput = {
      ...(providerParams ?? {}),
      ...paramValuesRef.current,
    }
    const nextAuthInput = {
      ...(authParams ?? {}),
      apiKey: paramValuesRef.current.apiKey ?? authParams?.apiKey,
      apiSecret: paramValuesRef.current.apiSecret ?? authParams?.apiSecret,
    }

    onSave({
      providerParams: sanitizeMarketProviderParamsForWidget(
        trimmedProviderId,
        nextProviderParamsInput
      ),
      auth: sanitizeMarketProviderAuthRefs(nextAuthInput),
    })
    setSettingsOpen(false)
  }

  return (
    <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type='button'
              className={widgetHeaderIconButtonClassName()}
              disabled={!trimmedProviderId}
              aria-label='Market provider settings'
            >
              <KeyRound className='h-3.5 w-3.5' />
              <span className='sr-only'>Market provider settings</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>Provider settings</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-72 space-y-3 p-4'>
        <div className='space-y-1'>
          <p className='font-medium text-sm'>Provider settings</p>
          <p className='text-muted-foreground text-xs'>
            Use environment variable references for credentials.
          </p>
        </div>
        <div className='space-y-3'>
          {definitions.map((definition) => {
            const inputId = `market-provider-param-${trimmedProviderId}-${definition.id}`
            const isCredential = isMarketProviderCredentialDefinition(definition)
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
            const controlledValue = inputValues[definition.id] ?? inputValue ?? ''
            const validationError = validationErrors[definition.id]
            if (definition.inputType === 'switch' || definition.type === 'boolean') {
              return (
                <div
                  key={`${trimmedProviderId}-${definition.id}`}
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
                <div key={`${trimmedProviderId}-${definition.id}`} className='space-y-1'>
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
              <div key={`${trimmedProviderId}-${definition.id}`} className='space-y-1'>
                <Label htmlFor={inputId} className='text-xs'>
                  {definition.title ?? definition.id}
                </Label>
                <Input
                  id={inputId}
                  type={
                    isCredential ? 'password' : definition.type === 'number' ? 'number' : 'text'
                  }
                  value={controlledValue}
                  onChange={(event) => {
                    setInputValues((current) => ({
                      ...current,
                      [definition.id]: event.target.value,
                    }))
                    handleParamChange(definition.id, event.target.value)
                  }}
                  placeholder={definition.placeholder}
                  min={definition.min}
                  max={definition.max}
                  step={definition.step}
                  autoComplete='off'
                  aria-invalid={validationError ? true : undefined}
                  className={validationError ? 'border-destructive' : undefined}
                />
                {validationError ? (
                  <p className='text-[11px] text-destructive'>{validationError}</p>
                ) : null}
                {isCredential ? (
                  <p className='text-[11px] text-muted-foreground'>Use {'{{ ENV_VAR }}'}.</p>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className='flex justify-end gap-2'>
          <Button size='sm' variant='outline' onClick={() => setSettingsOpen(false)}>
            Cancel
          </Button>
          <Button size='sm' onClick={handleSave}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
