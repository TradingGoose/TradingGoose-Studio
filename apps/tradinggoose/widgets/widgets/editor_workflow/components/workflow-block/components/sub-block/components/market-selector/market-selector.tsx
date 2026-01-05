import { useEffect, useMemo, useRef } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { MarketSelectorCombo } from '@/components/market/market-selector-combo'
import {
  createEmptyMarketSelectorInstance,
  useMarketSelectorStore,
} from '@/stores/market/selector/store'
import { useSubBlockValue } from '@/widgets/widgets/editor_workflow/components/workflow-block/components/sub-block/hooks/use-sub-block-value'

interface MarketSelectorInputProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: string | null
  value?: string | null
  onChange?: (value: string | null) => void
  disabled?: boolean
  config?: SubBlockConfig
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
  const [storeValue, setStoreValue] = useSubBlockValue<string | null>(blockId, subBlockId)
  const [providerValue] = useSubBlockValue<string | null>(blockId, 'provider')
  const ensureInstance = useMarketSelectorStore((state) => state.ensureInstance)
  const updateInstance = useMarketSelectorStore((state) => state.updateInstance)
  const instance = useMarketSelectorStore((state) => state.instances[`${blockId}-${subBlockId}`])

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

  useEffect(() => {
    if (currentValue && safeInstance.selectedListingId !== currentValue) {
      updateInstance(instanceId, { selectedListingId: currentValue })
      return
    }

    if (!currentValue && safeInstance.selectedListingId) {
      updateInstance(instanceId, { selectedListingId: undefined, selectedListing: null })
    }
  }, [currentValue, safeInstance.selectedListingId, instanceId, updateInstance])

  useEffect(() => {
    if (isPreview || disabled) return
    const normalizedProvider = providerValue ?? undefined
    const prevProvider = previousProviderRef.current
    const hasPreviousProvider = Boolean(prevProvider)
    const providerChanged = hasPreviousProvider && prevProvider !== normalizedProvider
    const needsProviderSync = safeInstance.providerId !== normalizedProvider

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
      disabled={disabled || isPreview}
      listingRequired={config?.required === true}
      onListingChange={(listingId) => {
        if (isPreview || disabled) return
        if (onChange) {
          onChange(listingId ?? null)
          return
        }
        setStoreValue(listingId ?? null)
      }}
    />
  )
}
