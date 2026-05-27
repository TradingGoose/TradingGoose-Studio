'use client'

import { ProviderSelector, type ProviderSelectorVariant } from '@/components/provider-selector'
import type { MarketProviderOption } from '@/providers/market/providers'

interface MarketProviderSelectorProps {
  value?: string | null
  options: MarketProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
  menuClassName?: string
  variant?: ProviderSelectorVariant
}

const DEFAULT_PLACEHOLDER = 'Select Market Provider'

export function MarketProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  triggerClassName,
  menuClassName,
  variant = 'widget',
}: MarketProviderSelectorProps) {
  return (
    <ProviderSelector
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      triggerClassName={triggerClassName}
      menuClassName={menuClassName}
      variant={variant}
      ariaLabel='Select market provider'
      tooltipText='Select market data provider'
      formatSelectedLabel={(option, currentVariant) =>
        currentVariant === 'form' ? option.name : `Market: ${option.name}`
      }
    />
  )
}
