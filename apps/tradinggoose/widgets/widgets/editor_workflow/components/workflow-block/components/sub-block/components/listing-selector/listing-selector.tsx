import { useEffect, useMemo, useRef, useState } from 'react'
import { ListingSelector } from '@/components/listing-selector/selector/combo'
import {
  areListingIdentitiesEqual,
  type ListingInputValue,
  type ListingOption,
  toListingValue,
  toListingValueObject,
} from '@/lib/listing/identity'
import { evaluateSubBlockConditionValues } from '@/lib/workflows/sub-block-conditions'
import type { SubBlockConfig } from '@/blocks/types'
import { useTagSelection } from '@/hooks/use-tag-selection'
import { toPortfolioValueObject } from '@/providers/trading/portfolio-identity'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { useDependsOnGate } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-depends-on-gate'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useOptionalWorkflowRoute } from '@/widgets/widgets/editor_workflow/context/workflow-route-context'

interface ListingSelectorInputProps {
  blockId: string
  subBlockId: string
  value?: ListingInputValue
  onChange?: (value: ListingInputValue) => void
  disabled?: boolean
  config?: SubBlockConfig
  providerType?: 'market' | 'trading'
  tradingProviderFieldId?: string
  contextValues?: Record<string, any>
}

function isVariableListingInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return trimmed.startsWith('<')
}

const resolveListingProviderId = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return toPortfolioValueObject(value)?.providerId
}

const dependsOnIncludes = (dependsOn: SubBlockConfig['dependsOn'], field: string): boolean => {
  if (Array.isArray(dependsOn)) return dependsOn.includes(field)
  return Boolean(dependsOn?.all?.includes(field) || dependsOn?.any?.includes(field))
}

const readContextValue = (contextValues: Record<string, any> | undefined, field: string) => {
  if (!contextValues || !Object.hasOwn(contextValues, field)) return undefined
  return contextValues[field]
}

const toFetchedListingOption = (option: { value?: unknown }) => {
  const identity = toListingValueObject(option.value)
  if (
    !identity ||
    !option.value ||
    typeof option.value !== 'object' ||
    Array.isArray(option.value)
  ) {
    return null
  }

  return option.value as ListingOption
}

const isListingOption = (value: ListingOption | null): value is ListingOption => Boolean(value)

export function ListingSelectorInput({
  blockId,
  subBlockId,
  value,
  onChange,
  disabled = false,
  config,
  providerType,
  tradingProviderFieldId,
  contextValues,
}: ListingSelectorInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<ListingInputValue>(blockId, subBlockId)
  const routeContext = useOptionalWorkflowRoute()
  const resolvedProviderType = providerType ?? config?.providerType ?? 'market'
  const configuredTradingProviderField = tradingProviderFieldId ?? config?.tradingProviderFieldId
  const providerField = 'provider'
  const hasLocalProviderSource =
    !configuredTradingProviderField && dependsOnIncludes(config?.dependsOn, providerField)
  const [providerValueFromStore] = useSubBlockValue<unknown>(blockId, providerField)
  const [tradingProviderValueFromStore] = useSubBlockValue<unknown>(
    blockId,
    configuredTradingProviderField ?? providerField
  )
  const providerValue = hasLocalProviderSource
    ? (readContextValue(contextValues, providerField) ?? providerValueFromStore)
    : undefined
  const tradingProviderValue = configuredTradingProviderField
    ? (readContextValue(contextValues, configuredTradingProviderField) ??
      tradingProviderValueFromStore)
    : undefined
  const primaryProviderId = resolveListingProviderId(providerValue)
  const marketProviderId = resolvedProviderType === 'market' ? primaryProviderId : undefined
  const tradingProviderId =
    resolveListingProviderId(tradingProviderValue) ??
    (resolvedProviderType === 'trading' ? primaryProviderId : undefined)
  const providerId = resolvedProviderType === 'trading' ? tradingProviderId : marketProviderId
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instance = useListingSelectorStore((state) => state.instances[`${blockId}-${subBlockId}`])
  const emitTagSelection = useTagSelection(blockId, subBlockId)
  const resolvedConfig: SubBlockConfig = config ?? {
    id: subBlockId,
    title: 'Listing',
    type: 'market-selector',
  }
  const { finalDisabled: dependsOnDisabled } = useDependsOnGate(blockId, resolvedConfig, {
    disabled,
    contextValues,
  })
  const usesFetchedListingOptions =
    Boolean(config?.fetchOptions) &&
    evaluateSubBlockConditionValues(config?.fetchOptionsCondition, contextValues ?? {})
  const finalDisabled = dependsOnDisabled
  const [fetchedListingOptions, setFetchedListingOptions] = useState<ListingOption[] | null>(null)
  const [isLoadingListingOptions, setIsLoadingListingOptions] = useState(false)
  const [listingOptionsError, setListingOptionsError] = useState<string | undefined>()

  const instanceId = useMemo(() => `${blockId}-${subBlockId}`, [blockId, subBlockId])
  const previousProviderRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const normalizedValue = value === '' ? null : value
  const hasPropValue = value !== undefined
  const currentValue = (hasPropValue ? normalizedValue : storeValue) ?? null
  const currentListingIdentity = toListingValueObject(currentValue)
  const currentListing =
    currentValue && typeof currentValue === 'object'
      ? (() => {
          const record = currentValue as Record<string, unknown>
          const hasDisplayFields =
            typeof record.base === 'string' ||
            typeof record.name === 'string' ||
            typeof record.iconUrl === 'string'
          return hasDisplayFields ? (currentValue as ListingOption) : null
        })()
      : null

  useEffect(() => {
    if (!usesFetchedListingOptions || finalDisabled || !config?.fetchOptions) {
      setFetchedListingOptions(null)
      setIsLoadingListingOptions(false)
      setListingOptionsError(undefined)
      return
    }

    let cancelled = false
    setFetchedListingOptions(null)
    setIsLoadingListingOptions(true)
    setListingOptionsError(undefined)

    config
      .fetchOptions(blockId, subBlockId, {
        channelId: routeContext?.channelId ?? '',
        workflowId: routeContext?.workflowId ?? null,
        workspaceId: routeContext?.workspaceId,
        contextValues,
      })
      .then((options) => {
        if (cancelled) return
        setFetchedListingOptions(options.map(toFetchedListingOption).filter(isListingOption))
      })
      .catch((error) => {
        if (cancelled) return
        setFetchedListingOptions(null)
        setListingOptionsError(error instanceof Error ? error.message : 'Failed to load listings')
      })
      .finally(() => {
        if (!cancelled) setIsLoadingListingOptions(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    usesFetchedListingOptions,
    finalDisabled,
    config,
    blockId,
    subBlockId,
    routeContext?.channelId,
    routeContext?.workflowId,
    routeContext?.workspaceId,
    contextValues,
  ])

  useEffect(() => {
    if (!usesFetchedListingOptions || !fetchedListingOptions || !currentListingIdentity) return
    if (typeof currentValue === 'string' && isVariableListingInput(currentValue)) return
    if (
      fetchedListingOptions.some((listing) =>
        areListingIdentitiesEqual(listing, currentListingIdentity)
      )
    ) {
      return
    }

    updateInstance(instanceId, { query: '', selectedListingValue: null, selectedListing: null })
    if (onChange) {
      onChange(null)
    } else {
      setStoreValue(null)
    }
  }, [
    usesFetchedListingOptions,
    currentListingIdentity,
    currentValue,
    fetchedListingOptions,
    instanceId,
    updateInstance,
    onChange,
    setStoreValue,
  ])

  useEffect(() => {
    if (typeof currentValue === 'string' && isVariableListingInput(currentValue)) {
      if (
        safeInstance.selectedListingValue ||
        safeInstance.selectedListing ||
        safeInstance.query !== currentValue
      ) {
        updateInstance(instanceId, {
          query: currentValue,
          selectedListingValue: null,
          selectedListing: null,
        })
      }
      return
    }

    if (!onChange && typeof currentValue === 'string' && !isVariableListingInput(currentValue)) {
      setStoreValue(null)
      return
    }

    const selectedListingValue = toListingValueObject(safeInstance.selectedListingValue)
    const currentListingValue = currentListingIdentity

    if (
      currentListingValue &&
      !areListingIdentitiesEqual(currentListingValue, selectedListingValue)
    ) {
      updateInstance(instanceId, {
        selectedListingValue: currentListingValue,
        ...(currentListing ? { selectedListing: currentListing } : null),
      })
      return
    }

    if (
      currentListing &&
      (!safeInstance.selectedListing ||
        !areListingIdentitiesEqual(safeInstance.selectedListing, currentListing))
    ) {
      updateInstance(instanceId, { selectedListing: currentListing })
      return
    }

    if (!currentListingValue && safeInstance.selectedListingValue) {
      updateInstance(instanceId, { selectedListingValue: null, selectedListing: null })
    }
  }, [
    currentListingIdentity,
    currentListing,
    safeInstance.selectedListingValue,
    safeInstance.selectedListing,
    safeInstance.query,
    instanceId,
    updateInstance,
    onChange,
    currentValue,
    setStoreValue,
  ])

  useEffect(() => {
    if (finalDisabled) return
    const normalizedProvider = providerId
    const providerSignature = [providerId, marketProviderId, tradingProviderId].join(':')
    const prevProvider = previousProviderRef.current
    const hasPreviousProvider = previousProviderRef.current !== undefined
    const storedProvider = safeInstance.providerId
    const providerMismatch = storedProvider !== normalizedProvider
    const providerChanged = hasPreviousProvider && prevProvider !== providerSignature
    const needsProviderSync = providerMismatch

    if (!providerChanged && !needsProviderSync) {
      previousProviderRef.current = providerSignature
      return
    }

    if (providerChanged) {
      updateInstance(instanceId, {
        providerId: normalizedProvider,
        query: '',
        results: [],
        error: undefined,
        selectedListingValue: null,
        selectedListing: null,
      })

      if (onChange) {
        onChange(null)
      } else {
        setStoreValue(null)
      }
    } else if (needsProviderSync) {
      updateInstance(instanceId, { providerId: normalizedProvider })
    }

    previousProviderRef.current = providerSignature
  }, [
    providerId,
    marketProviderId,
    tradingProviderId,
    safeInstance.providerId,
    instanceId,
    updateInstance,
    finalDisabled,
    onChange,
    setStoreValue,
  ])

  return (
    <ListingSelector
      instanceId={instanceId}
      blockId={blockId}
      disabled={finalDisabled}
      providerType={resolvedProviderType}
      marketProviderId={marketProviderId}
      tradingProviderId={tradingProviderId}
      candidateListings={usesFetchedListingOptions ? (fetchedListingOptions ?? []) : undefined}
      candidateListingsLoading={usesFetchedListingOptions && isLoadingListingOptions}
      candidateListingsError={usesFetchedListingOptions ? listingOptionsError : undefined}
      listingRequired={config?.required === true}
      onListingChange={(listing) => {
        if (finalDisabled) return
        const normalizedListing = toListingValue(listing)
        if (onChange) {
          onChange(normalizedListing ?? null)
          return
        }
        setStoreValue(normalizedListing ?? null)
      }}
      onListingValueChange={(value) => {
        if (finalDisabled) return
        if (onChange) {
          onChange(value ?? null)
          return
        }
        setStoreValue(value ?? null)
      }}
      onListingTagSelect={(value) => {
        if (finalDisabled) return
        emitTagSelection(value)
      }}
    />
  )
}
