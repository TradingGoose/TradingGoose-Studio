'use client'

import { useEffect, useMemo, useRef } from 'react'
import { ListingSearchInput } from '@/components/listing-selector/selector/input'
import {
  areListingIdentitiesEqual,
  type ListingIdentity,
  ListingIdentitySchema,
  type ListingResolved,
} from '@/lib/listing/identity'
import {
  createEmptyListingSelectorInstance,
  useListingSelectorStore,
} from '@/stores/market/selector/store'
import { useWidgetConfigRuntimeActions } from '@/widgets/widget-config-runtime'
import type { DataChartWidgetParams } from '@/widgets/widgets/data_chart/contract'

type DataChartListingControlProps = {
  widgetKey?: string
  panelId?: string
  params: DataChartWidgetParams
}

type DataChartListingSelectorProps = {
  instanceId: string
  providerId?: string
  onListingChange: (selected: ListingResolved | null) => void
}

export const DataChartListingSelector = ({
  instanceId,
  providerId,
  onListingChange,
}: DataChartListingSelectorProps) => (
  <div className='min-w-[240px]'>
    <ListingSearchInput
      instanceId={instanceId}
      variant='header'
      disabled={!providerId}
      onListingChange={onListingChange}
    />
  </div>
)

export const DataChartListingControl = ({
  widgetKey,
  panelId,
  params,
}: DataChartListingControlProps) => {
  const providerId = params.data?.provider
  const parsedListing = ListingIdentitySchema.safeParse(params.listing)
  const listingIdentity = parsedListing.success ? parsedListing.data : null
  const ensureInstance = useListingSelectorStore((state) => state.ensureInstance)
  const updateInstance = useListingSelectorStore((state) => state.updateInstance)
  const instanceId = useMemo(
    () => (panelId ? `chart-${panelId}` : `chart-${widgetKey ?? 'widget'}`),
    [panelId, widgetKey]
  )
  const instance = useListingSelectorStore((state) => state.instances[instanceId])
  const safeInstance = instance ?? createEmptyListingSelectorInstance()
  const actions = useWidgetConfigRuntimeActions()
  const previousProviderRef = useRef<string | undefined>(undefined)
  const syncedInstanceIdRef = useRef<string | null>(null)
  const syncedListingIdentityRef = useRef<ListingIdentity | null | undefined>(undefined)

  useEffect(() => {
    ensureInstance(instanceId)
  }, [ensureInstance, instanceId])

  useEffect(() => {
    const normalizedProvider = providerId ?? undefined
    const previousProvider = previousProviderRef.current
    const providerChanged =
      previousProvider !== undefined && previousProvider !== normalizedProvider

    if (providerChanged) {
      updateInstance(instanceId, {
        providerId: normalizedProvider,
        query: '',
        results: [],
        error: undefined,
        isLoading: false,
      })
    } else if (safeInstance.providerId !== normalizedProvider) {
      updateInstance(instanceId, { providerId: normalizedProvider })
    }

    previousProviderRef.current = normalizedProvider
  }, [providerId, safeInstance.providerId, instanceId, updateInstance])

  useEffect(() => {
    const previouslySyncedListing = syncedListingIdentityRef.current
    const alreadySyncedInstance = syncedInstanceIdRef.current === instanceId
    const alreadySynced =
      alreadySyncedInstance &&
      previouslySyncedListing !== undefined &&
      ((previouslySyncedListing === null && listingIdentity === null) ||
        areListingIdentitiesEqual(previouslySyncedListing, listingIdentity))

    if (alreadySynced) {
      return
    }

    syncedInstanceIdRef.current = instanceId
    syncedListingIdentityRef.current = listingIdentity

    if (listingIdentity) {
      updateInstance(instanceId, {
        selectedListing: listingIdentity,
        query: '',
      })
      return
    }

    updateInstance(instanceId, {
      selectedListing: null,
      query: '',
    })
  }, [listingIdentity, instanceId, updateInstance])

  const handleListingChange = (selected: ListingResolved | null) => {
    const normalized = selected?.listingIdentity
    actions.patchWidgetLinkedParams?.({ listing: normalized ?? null })
  }

  return (
    <DataChartListingSelector
      instanceId={instanceId}
      providerId={providerId}
      onListingChange={handleListingChange}
    />
  )
}
