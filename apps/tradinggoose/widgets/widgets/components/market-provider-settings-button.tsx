'use client'

import { useEffect, useRef, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { checkEnvVarTrigger, EnvVarDropdown } from '@/components/ui/env-var-dropdown'
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
  isMarketProviderCredentialDefinition,
  resolveMarketProviderSettingsDefinitions,
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import { cn } from '@/lib/utils'
import type { MarketProviderParamDefinition } from '@/providers/market/providers'
import { widgetHeaderControlClassName } from '@/widgets/widgets/components/widget-header-control'

export type MarketProviderSettingsSaveResult = {
  auth?: Record<string, unknown>
  providerParams?: Record<string, unknown>
}

type MarketProviderSettingsButtonProps = {
  providerId?: string | null
  providerName?: string
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

type MarketProviderTextInputProps = {
  id: string
  definition: MarketProviderParamDefinition
  value: string
  isCredential: boolean
  workspaceId?: string
  onChange: (value: string) => void
}

function MarketProviderTextInput({
  id,
  definition,
  value,
  isCredential,
  workspaceId,
  onChange,
}: MarketProviderTextInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [showEnvVars, setShowEnvVars] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [cursorPosition, setCursorPosition] = useState(0)

  const updateEnvPicker = (nextValue: string, nextCursorPosition: number, focused: boolean) => {
    if (!focused) {
      setShowEnvVars(false)
      setSearchTerm('')
      return
    }

    const envVarTrigger = checkEnvVarTrigger(nextValue, nextCursorPosition)
    const shouldShowCredentialPicker =
      isCredential && (nextValue.trim() === '' || envVarTrigger.show)

    setShowEnvVars(shouldShowCredentialPicker || envVarTrigger.show)
    setSearchTerm(envVarTrigger.show ? envVarTrigger.searchTerm : '')
  }

  return (
    <div className='relative'>
      <Input
        ref={inputRef}
        id={id}
        type={isCredential ? 'password' : definition.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(event) => {
          const nextValue = event.target.value
          const nextCursorPosition = event.target.selectionStart ?? nextValue.length
          setCursorPosition(nextCursorPosition)
          onChange(nextValue)
          updateEnvPicker(nextValue, nextCursorPosition, true)
        }}
        onFocus={(event) => {
          const nextCursorPosition = event.currentTarget.selectionStart ?? value.length
          setCursorPosition(nextCursorPosition)
          updateEnvPicker(value, nextCursorPosition, true)
        }}
        onBlur={() => {
          setShowEnvVars(false)
          setSearchTerm('')
        }}
        placeholder={definition.placeholder}
        min={definition.min}
        max={definition.max}
        step={definition.step}
        autoComplete='off'
        autoCorrect='off'
        autoCapitalize='off'
        spellCheck={false}
      />
      {isCredential ? (
        <EnvVarDropdown
          visible={showEnvVars}
          onSelect={(nextValue) => {
            onChange(nextValue)
            setShowEnvVars(false)
            setSearchTerm('')
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          searchTerm={searchTerm}
          inputValue={value}
          cursorPosition={cursorPosition}
          workspaceId={workspaceId}
          onClose={() => {
            setShowEnvVars(false)
            setSearchTerm('')
          }}
        />
      ) : null}
    </div>
  )
}

export function MarketProviderSettingsButton({
  providerId,
  providerName,
  providerParams,
  authParams,
  workspaceId,
  onSave,
}: MarketProviderSettingsButtonProps) {
  const trimmedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const definitions = resolveMarketProviderSettingsDefinitions(trimmedProviderId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const paramValuesRef = useRef<Record<string, unknown>>({})
  const changedParamIdsRef = useRef<Set<string>>(new Set())
  const [inputValues, setInputValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!settingsOpen) return
    paramValuesRef.current = {}
    changedParamIdsRef.current = new Set()
    setInputValues({})
  }, [settingsOpen])

  if (definitions.length === 0) return null

  const resolvedProviderName = providerName?.trim() || 'Market'
  const triggerLabel = `${resolvedProviderName} config`

  const handleParamChange = (id: string, value: unknown) => {
    changedParamIdsRef.current.add(id)
    if (typeof value === 'string' && value.trim() === '') {
      delete paramValuesRef.current[id]
      return
    }
    paramValuesRef.current[id] = value
  }

  const handleSave = () => {
    if (!trimmedProviderId) return

    const nextProviderParamsInput = {
      ...(providerParams ?? {}),
      ...paramValuesRef.current,
    }
    const resolveNextCredentialValue = (id: 'apiKey' | 'apiSecret') =>
      changedParamIdsRef.current.has(id) ? paramValuesRef.current[id] : authParams?.[id]

    const nextAuthInput = {
      ...(authParams ?? {}),
      apiKey: resolveNextCredentialValue('apiKey'),
      apiSecret: resolveNextCredentialValue('apiSecret'),
    }

    onSave({
      providerParams: sanitizeMarketProviderParamsForWidget(
        trimmedProviderId,
        nextProviderParamsInput
      ),
      auth: sanitizeMarketProviderAuth(nextAuthInput),
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
              className={widgetHeaderControlClassName(
                cn('flex justify-between gap-1.5')
              )}
              disabled={!trimmedProviderId}
              aria-label={`Configure ${resolvedProviderName} provider`}
            >
              <KeyRound className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
              <span className='min-w-0 text-left'>{triggerLabel}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side='top'>{triggerLabel}</TooltipContent>
      </Tooltip>
      <PopoverContent className='w-72 space-y-3 p-4'>
        <div className='space-y-1'>
          <p className='font-medium text-sm'>Provider settings</p>
          <p className='text-muted-foreground text-xs'>Save credentials for this widget.</p>
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
              }) ?? (isCredential ? undefined : definition.defaultValue)
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
                <MarketProviderTextInput
                  id={inputId}
                  definition={definition}
                  isCredential={isCredential}
                  value={controlledValue}
                  onChange={(value) => {
                    setInputValues((current) => ({
                      ...current,
                      [definition.id]: value,
                    }))
                    handleParamChange(definition.id, value)
                  }}
                  workspaceId={workspaceId}
                />
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
