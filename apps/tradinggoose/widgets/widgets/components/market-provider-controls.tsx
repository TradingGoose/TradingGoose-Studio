'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  type MarketProviderOption,
  MarketProviderSelector,
} from '@/widgets/widgets/components/market-provider-selector'
import {
  MarketProviderSettingsButton,
  type MarketProviderSettingsSaveResult,
} from '@/widgets/widgets/components/market-provider-settings-button'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'

type MarketProviderControlsProps = {
  value?: string | null
  options: MarketProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  providerParams?: Record<string, unknown>
  authParams?: Record<string, unknown>
  workspaceId?: string
  onSettingsSave: (next: MarketProviderSettingsSaveResult) => void
  className?: string
}

export function MarketProviderControls({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  providerParams,
  authParams,
  workspaceId,
  onSettingsSave,
  className,
}: MarketProviderControlsProps) {
  const selectedProvider = useMemo(
    () => options.find((option) => option.id === value),
    [options, value]
  )

  return (
    <div className={widgetHeaderButtonGroupClassName(cn('min-w-0', className))}>
      <MarketProviderSelector
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
      />
      <MarketProviderSettingsButton
        providerId={value}
        providerName={selectedProvider?.name}
        providerParams={providerParams}
        authParams={authParams}
        workspaceId={workspaceId}
        onSave={onSettingsSave}
      />
    </div>
  )
}
