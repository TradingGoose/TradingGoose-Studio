'use client'

import { cn } from '@/lib/utils'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import {
  type TradingAccountSelection,
  TradingAccountSelector,
} from '@/widgets/widgets/components/trading-account-selector'
import {
  type TradingProviderOption,
  TradingProviderSelector,
} from '@/widgets/widgets/components/trading-provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/widgets/widgets/components/widget-header-control'

type TradingProviderControlsProps = {
  workspaceId?: string | null
  providerId?: string | null
  providerOptions: TradingProviderOption[]
  onProviderChange?: (providerId: string) => void
  credentialServiceId?: string | null
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
  workspaceId,
  providerId,
  providerOptions,
  onProviderChange,
  credentialServiceId,
  portfolioIdentity,
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
          workspaceId={workspaceId}
          providerId={selectedProviderId}
          credentialServiceId={credentialServiceId}
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
