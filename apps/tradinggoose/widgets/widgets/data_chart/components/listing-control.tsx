'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import {
  resolveListingKey,
  toListingValue,
  toListingValueObject,
  type ListingOption,
} from '@/lib/listing/identity'
import { usePairColorContext, useSetPairColorContext } from '@/stores/dashboard/pair-store'
import type { PairColor } from '@/widgets/pair-colors'
import { ListingSelector } from '@/widgets/widgets/components/listing-selector'
import { emitDataChartParamsChange } from '@/widgets/utils/chart-params'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/types'

const hasListingDetails = (listing?: ListingOption | null): boolean => {
  if (!listing) return false
  const base = listing.base?.trim()
  const name = listing.name?.trim()
  if (listing.listing_type === 'equity') {
    return Boolean(base || name)
  }
  const quote = listing.quote?.trim()
  return Boolean((base && quote) || name)
}

type DataChartListingControlProps = {
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
  pairColor: PairColor
}

type DataChartListingSelectorProps = {
  instanceId: string
  providerId?: string
  onListingChange: (selected: ListingOption | null) => void
}

export const DataChartListingSelector = ({
  instanceId,
  providerId,
  onListingChange,
}: DataChartListingSelectorProps) => (
  <div className='min-w-[240px]'>
    <ListingSelector
      instanceId={instanceId}
      disabled={!providerId}
      onListingChange={onListingChange}
    />
  </div>
)

export const DataChartListingControl = ({
  widgetKey,
  panelId,
  params,
  pairColor,
}: DataChartListingControlProps) => {
  const providerId = params.provider
  const pairContext = usePairColorContext(pairColor)
  const rawListing = pairColor !== 'gray' ? pairContext.listing ?? null : params.listing ?? null
  const listingIdentity = useMemo(() => {
    if (!rawListing || typeof rawListing !== 'object') return null
    return toListingValueObject(rawListing)
  }, [rawListing])
  const displayListing = useMemo(() => {
    if (!rawListing || typeof rawListing !== 'object') return null
    const candidate = rawListing as ListingOption
    return hasListingDetails(candidate) ? candidate : null
  }, [rawListing])
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const clearSelection = useListingSelectorStore((state) => state.clearSelection)
  const instanceId = useMemo(
    () => (panelId ? `chart-${panelId}` : `chart-${widgetKey ?? 'widget'}`),
    [panelId, widgetKey]
  )
  const instance = useListingSelectorStore((state) => state.instances[instanceId])
  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const setPairContext = useSetPairColorContext()
  const previousProviderRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  useEffect(() => {
    if (pairColor !== 'gray') return
    if (params.listing == null) return
    if (typeof params.listing === 'string') {
      emitDataChartParamsChange({
        params: { listing: null },
        panelId,
        widgetKey,
      })
      return
    }

    const normalized = toListingValueObject(params.listing)
    if (!normalized) {
      emitDataChartParamsChange({
        params: { listing: null },
        panelId,
        widgetKey,
      })
    }
  }, [pairColor, params.listing, panelId, widgetKey])

  useEffect(() => {
    const normalizedProvider = providerId ?? undefined
    const previousProvider = previousProviderRef.current
    const providerChanged = previousProvider !== undefined && previousProvider !== normalizedProvider

    if (providerChanged) {
      updateInstance(instanceId, {
        providerId: normalizedProvider,
        query: '',
        results: [],
        error: undefined,
        selectedListingValue: null,
        selectedListing: null,
      })
      clearSelection(instanceId)
      if (pairColor === 'gray') {
        emitDataChartParamsChange({
          params: { listing: null },
          panelId,
          widgetKey,
        })
      } else {
        setPairContext(pairColor, { listing: null })
      }
    } else if (safeInstance.providerId !== normalizedProvider) {
      updateInstance(instanceId, { providerId: normalizedProvider })
    }

    previousProviderRef.current = normalizedProvider
  }, [
    providerId,
    safeInstance.providerId,
    instanceId,
    updateInstance,
    clearSelection,
    pairColor,
    panelId,
    widgetKey,
    setPairContext,
  ])

  useEffect(() => {
    const currentListingKey = listingIdentity ? resolveListingKey(listingIdentity) : null
    const selectedListingKey = resolveListingKey(safeInstance.selectedListingValue ?? null)

    if (currentListingKey && currentListingKey !== selectedListingKey) {
      updateInstance(instanceId, {
        selectedListingValue: listingIdentity ?? null,
        selectedListing: displayListing,
        query: currentListingKey,
      })
      return
    }

    if (!currentListingKey && safeInstance.selectedListingValue) {
      updateInstance(instanceId, {
        selectedListingValue: null,
        selectedListing: null,
        query: '',
      })
    }
  }, [
    listingIdentity,
    displayListing,
    safeInstance.selectedListingValue,
    instanceId,
    updateInstance,
  ])

  const handleListingChange = (selected: ListingOption | null) => {
    const normalized = toListingValue(selected)
    if (pairColor === 'gray') {
      emitDataChartParamsChange({
        params: { listing: normalized ?? null },
        panelId,
        widgetKey,
      })
    } else {
      setPairContext(pairColor, { listing: normalized ?? null })
    }
  }

  return (
    <DataChartListingSelector
      instanceId={instanceId}
      providerId={providerId}
      onListingChange={handleListingChange}
    />
  )
}
