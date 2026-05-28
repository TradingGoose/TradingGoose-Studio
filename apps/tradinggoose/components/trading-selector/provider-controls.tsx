'use client'

import {
  type TradingAccountSelection,
  TradingAccountSelector,
} from '@/components/trading-selector/account-selector'
import {
  type TradingProviderOption,
  TradingProviderSelector,
} from '@/components/trading-selector/provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import { cn } from '@/lib/utils'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'

type TradingProviderControlsProps = {
  providerId?: string | null
  providerOptions: TradingProviderOption[]
  onProviderChange?: (providerId: string) => void
  serviceId?: string | null
  portfolioIdentity?: PortfolioIdentity | null
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
  serviceId,
  portfolioIdentity,
  disabled = false,
  providerPlaceholder,
  accountPlaceholder,
  accountTooltipText,
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
          serviceId={serviceId}
          portfolioIdentity={portfolioIdentity}
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
