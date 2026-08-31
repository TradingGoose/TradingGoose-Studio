import { useEffect, useMemo, useRef, useState } from 'react'
import { ListingSelector } from '@/components/listing-selector/selector/combo'
import {
  areListingIdentitiesEqual,
  type ListingInputValue,
  type ListingResolved,
  ListingResolvedSchema,
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

const EMPTY_LISTING_OPTIONS: ListingResolved[] = []

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
  const fetchOptions = config?.fetchOptions
  const usesFetchedListingOptions =
    Boolean(fetchOptions) &&
    evaluateSubBlockConditionValues(config?.fetchOptionsCondition, contextValues ?? {})
  const finalDisabled = dependsOnDisabled
  const [fetchedListingOptions, setFetchedListingOptions] = useState<ListingResolved[] | null>(null)
  const [isLoadingListingOptions, setIsLoadingListingOptions] = useState(false)
  const [listingOptionsError, setListingOptionsError] = useState<string | undefined>()

  const instanceId = useMemo(() => `${blockId}-${subBlockId}`, [blockId, subBlockId])
  const contextValuesSignature = useMemo(() => JSON.stringify(contextValues ?? {}), [contextValues])
  const previousProviderRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const normalizedValue = value === '' ? null : value
  const hasPropValue = value !== undefined
  const currentValue = (hasPropValue ? normalizedValue : storeValue) ?? null
  const currentListingIdentity = toListingValueObject(currentValue)
  const currentListing = useMemo(() => {
    const parsed = ListingResolvedSchema.safeParse(currentValue)
    return parsed.success ? parsed.data : null
  }, [currentValue])

  useEffect(() => {
    if (!usesFetchedListingOptions || finalDisabled || !fetchOptions) {
      setFetchedListingOptions(null)
      setIsLoadingListingOptions(false)
      setListingOptionsError(undefined)
      return
    }

    let cancelled = false
    setFetchedListingOptions(null)
    setIsLoadingListingOptions(true)
    setListingOptionsError(undefined)

    fetchOptions(blockId, subBlockId, {
      channelId: routeContext?.channelId ?? '',
      workflowId: routeContext?.workflowId ?? null,
      workspaceId: routeContext?.workspaceId,
      contextValues,
    })
      .then((options) => {
        if (cancelled) return
        setFetchedListingOptions(
          options.flatMap((option) => {
            const parsed = ListingResolvedSchema.safeParse(option.value)
            return parsed.success ? [parsed.data] : []
          })
        )
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
    fetchOptions,
    blockId,
    subBlockId,
    routeContext?.channelId,
    routeContext?.workflowId,
    routeContext?.workspaceId,
    contextValuesSignature,
  ])

  useEffect(() => {
    if (!usesFetchedListingOptions || !fetchedListingOptions || !currentListingIdentity) return
    if (typeof currentValue === 'string' && isVariableListingInput(currentValue)) return
    if (
      fetchedListingOptions.some((listing) =>
        areListingIdentitiesEqual(listing.listingIdentity, currentListingIdentity)
      )
    ) {
      return
    }

    updateInstance(instanceId, { query: '', selectedListing: null })
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
      if (safeInstance.selectedListing || safeInstance.query !== currentValue) {
        updateInstance(instanceId, {
          query: currentValue,
          selectedListing: null,
        })
      }
      return
    }

    if (!onChange && typeof currentValue === 'string' && !isVariableListingInput(currentValue)) {
      setStoreValue(null)
      return
    }

    const selectedListingIdentity = toListingValueObject(safeInstance.selectedListing)
    const hasResolvedSelection = Boolean(
      safeInstance.selectedListing && 'listingIdentity' in safeInstance.selectedListing
    )
    const currentListingValue = currentListingIdentity

    if (
      currentListingValue &&
      !areListingIdentitiesEqual(currentListingValue, selectedListingIdentity)
    ) {
      updateInstance(instanceId, {
        selectedListing: currentListing ?? currentListingValue,
      })
      return
    }

    if (currentListing && !hasResolvedSelection) {
      updateInstance(instanceId, { selectedListing: currentListing })
      return
    }

    if (!currentListingValue && safeInstance.selectedListing) {
      updateInstance(instanceId, { selectedListing: null })
    }
  }, [
    currentListingIdentity,
    currentListing,
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
      candidateListings={
        usesFetchedListingOptions ? (fetchedListingOptions ?? EMPTY_LISTING_OPTIONS) : undefined
      }
      candidateListingsLoading={usesFetchedListingOptions && isLoadingListingOptions}
      candidateListingsError={usesFetchedListingOptions ? listingOptionsError : undefined}
      listingRequired={config?.required === true}
      onListingChange={(listing) => {
        if (finalDisabled) return
        const listingIdentity = listing?.listingIdentity
        if (onChange) {
          onChange(listingIdentity ?? null)
          return
        }
        setStoreValue(listingIdentity ?? null)
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
        if (onChange) return
        emitTagSelection(value)
      }}
    />
  )
}
