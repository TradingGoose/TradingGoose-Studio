'use client'

import { formatTemplate } from '@/i18n/template'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
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

export function TradingProviderSelector({
  value,
  options,
  onChange,
  disabled = false,
  placeholder,
  triggerClassName,
  menuClassName,
  variant = 'widget',
}: TradingProviderSelectorProps) {
  const copy = useWorkspaceWidgetsMessages().providerControls.tradingSelector
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
