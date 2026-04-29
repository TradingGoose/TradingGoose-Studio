'use client'

import { cn } from '@/lib/utils'
import {
  type TradingAccountSelection,
  TradingAccountSelector,
  type TradingEnvironmentOption,
} from '@/widgets/widgets/components/trading-account-selector'
import {
  type TradingProviderOption,
  TradingProviderSelector,
} from '@/widgets/widgets/components/trading-provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'

type TradingProviderControlsProps = {
  providerId?: string | null
  providerOptions: TradingProviderOption[]
  onProviderChange?: (providerId: string) => void
  credentialProviderId?: string
  environmentOptions: TradingEnvironmentOption[]
  credentialId?: string | null
  environment?: string | null
  accountId?: string | null
  disabled?: boolean
  providerPlaceholder?: string
  accountPlaceholder?: string
  accountTooltipText?: string
  toolName?: string
  onAccountSelect?: (selection: TradingAccountSelection) => void
  className?: string
}

export function TradingProviderControls({
  providerId,
  providerOptions,
  onProviderChange,
  credentialProviderId,
  environmentOptions,
  credentialId,
  environment,
  accountId,
  disabled = false,
  providerPlaceholder,
  accountPlaceholder = 'Select account',
  accountTooltipText = 'Select trading account',
  toolName,
  onAccountSelect,
  className,
}: TradingProviderControlsProps) {
  const selectedProviderId = typeof providerId === 'string' ? providerId.trim() : ''
  const hasSelectedProvider = Boolean(selectedProviderId)

  return (
    <div className={widgetHeaderButtonGroupClassName(cn('min-w-0', className))}>
      <TradingProviderSelector
        value={selectedProviderId}
        options={providerOptions}
        onChange={onProviderChange}
        disabled={disabled}
        placeholder={providerPlaceholder}
      />
      {hasSelectedProvider ? (
        <TradingAccountSelector
          providerId={selectedProviderId}
          credentialProviderId={credentialProviderId}
          environmentOptions={environmentOptions}
          credentialId={credentialId}
          environment={environment}
          accountId={accountId}
          disabled={disabled}
          placeholder={accountPlaceholder}
          tooltipText={accountTooltipText}
          toolName={toolName}
          onAccountSelect={onAccountSelect}
        />
      ) : null}
    </div>
  )
}
