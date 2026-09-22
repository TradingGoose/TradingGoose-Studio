'use client'

import { useLocale } from 'next-intl'
import type { SubBlockConfig } from '@/blocks/types'
import { translateWorkflowLabel } from '@/i18n/block-editor'
import type { LocaleCode } from '@/i18n/utils'
import { getMarketProviderDefinition } from '@/providers/market/providers'
import { ToolCredentialSelector } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/components/tool-input/components/tool-credential-selector'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface CredentialSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  contextValues?: Record<string, any>
}

export function CredentialSelector({
  blockId,
  subBlock,
  disabled,
  contextValues,
}: CredentialSelectorProps) {
  const locale = useLocale() as LocaleCode
  const { dependsOn, dependencyValues } = useDependsOnGate(blockId, subBlock, { contextValues })
  const [value, setValue] = useSubBlockValue<string>(blockId, subBlock.id)
  const isMarket = subBlock.providerType === 'market'
  const marketProvider = dependencyValues[dependsOn.indexOf('provider')]
  const provider = isMarket
    ? getMarketProviderDefinition(typeof marketProvider === 'string' ? marketProvider : '')?.oauth
        ?.provider
    : subBlock.provider
  if (!provider) return null

  return (
    <ToolCredentialSelector
      provider={provider}
      serviceId={isMarket ? provider : subBlock.serviceId}
      serviceIds={subBlock.serviceIds}
      requiredScopes={subBlock.requiredScopes}
      value={value ?? ''}
      onChange={setValue}
      label={
        isMarket
          ? subBlock.title
          : subBlock.placeholder || translateWorkflowLabel(locale, 'selectCredential')
      }
      disabled={disabled}
    />
  )
}
