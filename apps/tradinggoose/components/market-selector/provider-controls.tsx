'use client'

import { MarketProviderSelector } from '@/components/market-selector/provider-selector'
import {
  MarketProviderSettingsButton,
  type MarketProviderSettingsSaveResult,
} from '@/components/market-selector/provider-settings-button'
import { providerSelectorTriggerClassName } from '@/components/provider-selector'
import { widgetHeaderButtonGroupClassName } from '@/components/widget-header-control'
import {
  sanitizeMarketProviderAuth,
  sanitizeMarketProviderParamsForWidget,
} from '@/lib/market/market-provider-settings'
import { cn } from '@/lib/utils'
import { useWorkspaceWidgetsMessages } from '@/i18n/workspace-widget-hooks'
import {
  getMarketProviderDefinition,
  type MarketProviderOption,
} from '@/providers/market/providers'
import { ToolCredentialSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector'

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
  const copy = useWorkspaceWidgetsMessages().providerControls.accountSelector
  const selectedProvider = options.find((option) => option.id === value)
  const providerId = value?.trim() ?? ''
  const oauth = getMarketProviderDefinition(providerId)?.oauth

  return (
    <div className={widgetHeaderButtonGroupClassName(cn('min-w-0', className))}>
      <MarketProviderSelector
        value={value}
        options={options}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
      />
      {oauth ? (
        <ToolCredentialSelector
          provider={oauth.provider}
          serviceId={oauth.provider}
          workspaceId={workspaceId}
          label={copy.placeholder}
          value={
            typeof providerParams?.credentialId === 'string' ? providerParams.credentialId : ''
          }
          disabled={disabled}
          triggerClassName={providerSelectorTriggerClassName('widget', 'w-auto')}
          onChange={(credentialId) =>
            onSettingsSave({
              providerParams: sanitizeMarketProviderParamsForWidget(providerId, {
                ...providerParams,
                credentialId,
              }),
              auth: sanitizeMarketProviderAuth(authParams),
            })
          }
        />
      ) : null}
      <MarketProviderSettingsButton
        providerId={value}
        providerName={selectedProvider?.name}
        providerParams={providerParams}
        authParams={authParams}
        workspaceId={workspaceId}
        disabled={disabled}
        onSave={onSettingsSave}
      />
    </div>
  )
}
