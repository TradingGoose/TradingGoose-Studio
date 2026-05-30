'use client'

import { ProviderSelector, type ProviderSelectorVariant } from '@/components/provider-selector'
import { OAUTH_PROVIDERS, parseProvider } from '@/lib/oauth'
import { getTradingProviderDefinition } from '@/providers/trading/providers'

export type TradingProviderOption = {
  id: string
  name: string
}

export const resolveTradingProviderIcon = (providerId?: string) => {
  if (!providerId) return undefined

  const providerDefinition = getTradingProviderDefinition(providerId)
  if (providerDefinition?.icon) return providerDefinition.icon

  const oauthProvider = providerDefinition?.oauth?.provider
  return oauthProvider
    ? OAUTH_PROVIDERS[parseProvider(oauthProvider).baseProvider]?.icon
    : undefined
}

type TradingProviderSelectorProps = {
  value?: string | null
  options: TradingProviderOption[]
  onChange?: (providerId: string) => void
  disabled?: boolean
  placeholder?: string
  triggerClassName?: string
  menuClassName?: string
  variant?: ProviderSelectorVariant
}

const DEFAULT_PLACEHOLDER = 'Select Trading Provider'

export function TradingProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder = DEFAULT_PLACEHOLDER,
  triggerClassName,
  menuClassName,
  variant = 'widget',
}: TradingProviderSelectorProps) {
  const optionsWithIcons = options.map((option) => ({
    ...option,
    icon: resolveTradingProviderIcon(option.id),
  }))

  return (
    <ProviderSelector
      value={value}
      options={optionsWithIcons}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      triggerClassName={triggerClassName}
      menuClassName={menuClassName}
      variant={variant}
      ariaLabel='Select trading provider'
      tooltipText='Select broker'
      formatSelectedLabel={(option, currentVariant) =>
        currentVariant === 'form' ? option.name : `Broker: ${option.name}`
      }
    />
  )
}
