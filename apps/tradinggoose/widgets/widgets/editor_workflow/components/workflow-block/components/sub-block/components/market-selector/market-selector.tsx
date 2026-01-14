import { useEffect, useMemo, useRef } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { MarketSelectorCombo } from '@/components/market/market-selector-combo'
import {
  resolveListingKey,
  type ListingOption,
  toListingValue,
  toListingValueObject,
  type ListingInputValue,
} from '@/lib/market/listings'
import {
  createEmptyMarketSelectorInstance,
  useMarketSelectorStore,
} from '@/stores/market/selector/store'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useTagSelection } from '@/hooks/use-tag-selection'

interface MarketSelectorInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: ListingInputValue
  value?: ListingInputValue
  onChange?: (value: ListingInputValue) => void
  disabled?: boolean
  config?: SubBlockConfig
}

function readListingStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value === 'string' && value.trim()) {
    return value
  }
  if (typeof value === 'number' && !Number.isNaN(value)) {
    return String(value)
  }
  return null
}

function isVariableListingInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return trimmed.startsWith('<')
}

export function MarketSelectorInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  value,
  onChange,
  disabled = false,
  config,
}: MarketSelectorInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<ListingInputValue>(blockId, subBlockId)
  const [providerValue] = useSubBlockValue<string | null>(blockId, 'provider')
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)
  const updateInstance = useMarketSelectorStore((state) => state.updateInstance)
  const instance = useMarketSelectorStore((state) => state.instances[`${blockId}-${subBlockId}`])
  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const instanceId = useMemo(() => `${blockId}-${subBlockId}`, [blockId, subBlockId])
  const previousProviderRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyMarketSelectorInstance()
  const normalizedPreviewValue = previewValue === '' ? null : previewValue
  const normalizedValue = value === '' ? null : value
  const hasPropValue = value !== undefined
  const currentValue = (isPreview
    ? normalizedPreviewValue
    : hasPropValue
      ? normalizedValue
      : storeValue) ?? null
  const currentListingKey = resolveListingKey(currentValue)
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

    if (
      !onChange &&
      typeof currentValue === 'string' &&
      currentListingKey &&
      !currentListing &&
      !safeInstance.selectedListing
    ) {
      if (currentListingKey.includes(':')) {
        const [baseId, quoteId] = currentListingKey.split(':')
        setStoreValue({
          equity_id: null,
          base_id: baseId,
          quote_id: quoteId,
          base_asset_class: null,
          quote_asset_class: null,
        })
      } else {
        setStoreValue({
          equity_id: currentListingKey,
          base_id: null,
          quote_id: null,
          base_asset_class: null,
          quote_asset_class: null,
        })
      }
      return
    }

    if (
      currentValue &&
      typeof currentValue === 'object' &&
      !currentListing &&
      !safeInstance.selectedListing
    ) {
      const record = currentValue as Record<string, unknown>
      const baseId = readListingStringField(record, 'base_id')
      const quoteId = readListingStringField(record, 'quote_id')
      if (baseId && quoteId && currentListingKey) {
        updateInstance(instanceId, {
          selectedListing: {
            id: currentListingKey,
            base: baseId,
            quote: quoteId,
            equity_id: null,
            base_id: baseId,
            quote_id: quoteId,
            base_asset_class: readListingStringField(record, 'base_asset_class'),
            quote_asset_class: readListingStringField(record, 'quote_asset_class'),
          },
        })
      }
    }

    const selectedListingKey = resolveListingKey(safeInstance.selectedListingValue)
    const currentListingValue = currentValue ? toListingValueObject(currentValue) : null

    if (currentListingKey && selectedListingKey !== currentListingKey) {
      updateInstance(instanceId, {
        selectedListingValue: currentListingValue,
        ...(currentListing ? { selectedListing: currentListing } : null),
      })
      return
    }

    if (
      currentListing &&
      (!safeInstance.selectedListing ||
        safeInstance.selectedListing.id !== currentListing.id)
    ) {
      updateInstance(instanceId, { selectedListing: currentListing })
      return
    }

    if (!currentListingKey && safeInstance.selectedListingValue) {
      updateInstance(instanceId, { selectedListingValue: null, selectedListing: null })
    }
  }, [
    currentListingKey,
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
    if (isPreview || disabled) return
    const normalizedProvider = providerValue ?? undefined
    const prevProvider = previousProviderRef.current
    const hasPreviousProvider = previousProviderRef.current !== undefined
    const storedProvider = safeInstance.providerId
    const providerMismatch = storedProvider !== normalizedProvider
    const providerChanged = hasPreviousProvider && prevProvider !== normalizedProvider
    const needsProviderSync = providerMismatch

    if (!providerChanged && !needsProviderSync) {
      previousProviderRef.current = normalizedProvider
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

    previousProviderRef.current = normalizedProvider
  }, [
    providerValue,
    safeInstance.providerId,
    instanceId,
    updateInstance,
    isPreview,
    disabled,
    onChange,
    setStoreValue,
  ])

  return (
    <MarketSelectorCombo
      instanceId={instanceId}
      blockId={blockId}
      disabled={disabled || isPreview}
      listingRequired={config?.required === true}
      onListingChange={(listing) => {
        if (isPreview || disabled) return
        const normalizedListing = toListingValue(listing)
        if (onChange) {
          onChange(normalizedListing ?? null)
          return
        }
        setStoreValue(normalizedListing ?? null)
      }}
      onListingValueChange={(value) => {
        if (isPreview || disabled) return
        if (onChange) {
          onChange(value ?? null)
          return
        }
        setStoreValue(value ?? null)
      }}
      onListingTagSelect={(value) => {
        if (isPreview || disabled) return
        emitTagSelection(value)
      }}
    />
  )
}
