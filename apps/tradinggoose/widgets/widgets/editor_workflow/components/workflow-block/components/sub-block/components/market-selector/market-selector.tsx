import { useEffect, useMemo, useRef } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { MarketSelectorCombo } from '@/components/market/market-selector-combo'
import { resolveListingId, toListingValue, type ListingValue } from '@/lib/market/listings'
import {
  createEmptyMarketSelectorInstance,
  useMarketSelectorStore,
  type ListingOption,
} from '@/stores/market/selector/store'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useTagSelection } from '@/hooks/use-tag-selection'

interface MarketSelectorInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: ListingValue
  value?: ListingValue
  onChange?: (value: ListingValue) => void
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
  const [storeValue, setStoreValue] = useSubBlockValue<ListingValue>(blockId, subBlockId)
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
  const currentListingId = resolveListingId(currentValue)
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
        safeInstance.selectedListingId ||
        safeInstance.selectedListing ||
        safeInstance.query !== currentValue
      ) {
        updateInstance(instanceId, {
          query: currentValue,
          selectedListingId: undefined,
          selectedListing: null,
        })
      }
      return
    }

    if (
      !onChange &&
      typeof currentValue === 'string' &&
      currentListingId &&
      !currentListing &&
      !safeInstance.selectedListing
    ) {
      if (currentListingId.includes(':')) {
        const [baseId, quoteId] = currentListingId.split(':')
        setStoreValue({
          equity_id: null,
          base_id: baseId,
          quote_id: quoteId,
          base_asset_class: null,
          quote_asset_class: null,
        })
      } else {
        setStoreValue({
          equity_id: currentListingId,
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
      if (baseId && quoteId && currentListingId) {
        updateInstance(instanceId, {
          selectedListing: {
            id: currentListingId,
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

    if (currentListingId && safeInstance.selectedListingId !== currentListingId) {
      updateInstance(instanceId, {
        selectedListingId: currentListingId,
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

    if (!currentListingId && safeInstance.selectedListingId) {
      updateInstance(instanceId, { selectedListingId: undefined, selectedListing: null })
    }
  }, [
    currentListingId,
    currentListing,
    safeInstance.selectedListingId,
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
        selectedListingId: undefined,
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
