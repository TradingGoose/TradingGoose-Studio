import { useEffect, useMemo, useRef } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { ListingSelector } from '@/components/listing-selector/selector/combo'
import {
  resolveListingKey,
  type ListingOption,
  toListingValue,
  toListingValueObject,
  type ListingInputValue,
} from '@/lib/listing/identity'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import { useTagSelection } from '@/hooks/use-tag-selection'

interface ListingSelectorInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: ListingInputValue
  value?: ListingInputValue
  onChange?: (value: ListingInputValue) => void
  disabled?: boolean
  config?: SubBlockConfig
}

function isVariableListingInput(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return trimmed.startsWith('<')
}

export function ListingSelectorInput({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  value,
  onChange,
  disabled = false,
  config,
}: ListingSelectorInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<ListingInputValue>(blockId, subBlockId)
  const [providerValue] = useSubBlockValue<string | null>(blockId, 'provider')
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instance = useListingSelectorStore((state) => state.instances[`${blockId}-${subBlockId}`])
  const emitTagSelection = useTagSelection(blockId, subBlockId)

  const instanceId = useMemo(() => `${blockId}-${subBlockId}`, [blockId, subBlockId])
  const previousProviderRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  const safeInstance = instance ?? createEmptyListingSelectorInstance()
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
      !isVariableListingInput(currentValue)
    ) {
      setStoreValue(null)
      return
    }

    const selectedListingKey = resolveListingKey(safeInstance.selectedListingValue)
    const currentListingValue =
      currentValue && typeof currentValue === 'object'
        ? currentValue
        : currentValue
          ? toListingValueObject(currentValue)
          : null

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
    <ListingSelector
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
