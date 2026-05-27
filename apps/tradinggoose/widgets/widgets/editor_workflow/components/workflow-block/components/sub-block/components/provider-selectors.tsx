'use client'

import { useEffect, useMemo, useState } from 'react'
import { MarketProviderSelector } from '@/components/market-selector/provider-selector'
import { TradingAccountSelector } from '@/components/trading-selector/account-selector'
import { TradingProviderSelector } from '@/components/trading-selector/provider-selector'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { SubBlockConfig } from '@/blocks/types'
import { useOAuthProviderAvailability } from '@/hooks/queries/oauth-provider-availability'
import {
  getMarketProviderOptions,
  getMarketProviderOptionsByKind,
} from '@/providers/market/providers'
import {
  type PortfolioIdentity,
  toPortfolioValueObject,
} from '@/providers/trading/portfolio-identity'
import {
  getTradingWidgetProviderAvailabilityIds,
  getTradingWidgetProviderOptions,
} from '@/widgets/utils/trading-widget-providers'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'
import { useDependsOnGate } from '../hooks/use-depends-on-gate'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface ProviderSelectorProps {
  blockId: string
  subBlockId: string
  disabled?: boolean
  config: SubBlockConfig
  contextValues?: Record<string, any>
}

const readString = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  if (value && typeof value === 'object' && 'value' in value) {
    const nestedValue = (value as { value?: unknown }).value
    return typeof nestedValue === 'string' ? nestedValue.trim() : ''
  }
  return ''
}

function useOptionValueSync(
  value: string | null,
  setValue: (value: string) => void,
  options: Array<{ id: string }>,
  disabled: boolean,
  autoSelectFirstOption: boolean
) {
  useEffect(() => {
    if (disabled) return

    const optionIds = options.map((option) => option.id)
    if (value && optionIds.includes(value)) return

    const nextValue = autoSelectFirstOption ? (optionIds[0] ?? '') : ''
    if (value !== nextValue) {
      setValue(nextValue)
    }
  }, [autoSelectFirstOption, disabled, options, setValue, value])
}

export function WorkflowMarketProviderSelector({
  blockId,
  subBlockId,
  disabled = false,
  config,
  contextValues,
}: ProviderSelectorProps) {
  const [value, setValue] = useSubBlockValue<string>(blockId, subBlockId)
  const { finalDisabled } = useDependsOnGate(blockId, config, { disabled, contextValues })
  const options = useMemo(
    () =>
      config.marketProviderKind
        ? getMarketProviderOptionsByKind(config.marketProviderKind)
        : getMarketProviderOptions(),
    [config.marketProviderKind]
  )
  const selectedValue = readString(value)

  useOptionValueSync(
    selectedValue,
    setValue,
    options,
    finalDisabled,
    config.autoSelectFirstOption !== false
  )

  return (
    <TooltipProvider>
      <MarketProviderSelector
        value={selectedValue}
        options={options}
        onChange={setValue}
        disabled={finalDisabled}
        placeholder={config.placeholder}
        variant='form'
      />
    </TooltipProvider>
  )
}

export function WorkflowTradingProviderSelector({
  blockId,
  subBlockId,
  disabled = false,
  config,
  contextValues,
}: ProviderSelectorProps) {
  const kind = config.tradingProviderKind ?? 'order'
  const [value, setValue] = useSubBlockValue<string>(blockId, subBlockId)
  const { finalDisabled } = useDependsOnGate(blockId, config, { disabled, contextValues })
  const availabilityIds = useMemo(() => getTradingWidgetProviderAvailabilityIds(kind), [kind])
  const availabilityQuery = useOAuthProviderAvailability(availabilityIds, !finalDisabled)
  const options = useMemo(
    () =>
      availabilityQuery.data ? getTradingWidgetProviderOptions(kind, availabilityQuery.data) : [],
    [kind, availabilityQuery.data]
  )
  const selectedValue = readString(value)

  useOptionValueSync(
    selectedValue,
    setValue,
    options,
    finalDisabled || availabilityQuery.isLoading,
    config.autoSelectFirstOption !== false
  )

  return (
    <TooltipProvider>
      <TradingProviderSelector
        value={selectedValue}
        options={options}
        onChange={setValue}
        disabled={finalDisabled || availabilityQuery.isLoading}
        placeholder={config.placeholder}
        variant='form'
      />
    </TooltipProvider>
  )
}

export function WorkflowTradingAccountSelector({
  blockId,
  subBlockId,
  disabled = false,
  config,
  contextValues,
}: ProviderSelectorProps) {
  const route = useOptionalWorkflowRoute()
  const providerFieldId = config.tradingProviderFieldId ?? 'provider'
  const [value, setValue] = useSubBlockValue<PortfolioIdentity | ''>(blockId, subBlockId)
  const [storeProviderValue] = useSubBlockValue<string>(blockId, providerFieldId)
  const [requestedServiceId, setRequestedServiceId] = useState<string | null>(null)
  const { finalDisabled } = useDependsOnGate(blockId, config, { disabled, contextValues })
  const providerId = readString(contextValues?.[providerFieldId]) || readString(storeProviderValue)
  const portfolioIdentity = useMemo(() => toPortfolioValueObject(value), [value])

  useEffect(() => {
    setRequestedServiceId(null)
  }, [providerId])

  useEffect(() => {
    if (portfolioIdentity && portfolioIdentity.providerId !== providerId) {
      setValue('')
    }
  }, [portfolioIdentity, providerId, setValue])

  return (
    <TooltipProvider>
      <TradingAccountSelector
        workspaceId={route?.workspaceId}
        providerId={providerId}
        serviceId={requestedServiceId ?? portfolioIdentity?.serviceId}
        portfolioIdentity={portfolioIdentity}
        disabled={finalDisabled}
        placeholder={config.placeholder}
        tooltipText={config.tooltip ?? config.description ?? 'Select trading account'}
        toolName='Trading'
        onAccountSelect={(selection) => {
          setRequestedServiceId(
            selection.serviceId ?? selection.portfolioIdentity?.serviceId ?? null
          )
          const nextIdentity = selection.portfolioIdentity
            ? toPortfolioValueObject(selection.portfolioIdentity)
            : null
          setValue(nextIdentity ?? '')
        }}
        variant='form'
      />
    </TooltipProvider>
  )
}
