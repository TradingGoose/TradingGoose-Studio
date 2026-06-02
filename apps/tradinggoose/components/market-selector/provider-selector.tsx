'use client'

import { formatTemplate } from '@/i18n/utils'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
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

export function MarketProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  triggerClassName,
  menuClassName,
  variant = 'widget',
}: MarketProviderSelectorProps) {
  const copy = useWorkspaceWidgetsMessages().providerControls.marketSelector

  return (
    <ProviderSelector
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder ?? copy.placeholder}
      triggerClassName={triggerClassName}
      menuClassName={menuClassName}
      variant={variant}
      ariaLabel={copy.ariaLabel}
      tooltipText={copy.tooltip}
      selectionUnavailableText={copy.selectionUnavailable}
      emptyText={copy.noProviders}
      formatSelectedLabel={(option, currentVariant) =>
        currentVariant === 'form'
          ? option.name
          : formatTemplate(copy.selectedLabel, {
              providerName: option.name || copy.fallbackProviderName,
            })
      }
    />
  )
}
