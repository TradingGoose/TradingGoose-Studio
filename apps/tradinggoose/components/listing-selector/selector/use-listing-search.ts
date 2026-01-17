import { useEffect, useRef } from 'react'
import { useDebounce } from '@/hooks/use-debounce'
import { fetchListings } from '@/components/listing-selector/fetchers'
import type { ListingSelectorInstance } from '@/stores/market/selector/store'
import { buildMarketSearchRequest } from '@/components/listing-selector/selector/search-request'
import { useMarketProviderSearchConfig } from '@/components/listing-selector/selector/use-provider-config'

type UpdateInstance = (id: string, patch: Partial<ListingSelectorInstance>) => void

type UseMarketListingSearchOptions = {
  open: boolean
  query: string
  providerId?: string
  instanceId: string
  updateInstance: UpdateInstance
  isVariableInput: (value: string) => boolean
}

export function useMarketListingSearch({
  open,
  query,
  providerId,
  instanceId,
  updateInstance,
  isVariableInput,
}: UseMarketListingSearchOptions) {
  const debouncedQuery = useDebounce(query, 400)
  const requestKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const providerConfig = useMarketProviderSearchConfig(providerId)

  useEffect(() => {
    const effectiveQuery = open && !query.trim() ? query : debouncedQuery
    const rawQuery = effectiveQuery
    const trimmed = rawQuery.trim()

    if (!open) {
      if (!trimmed) {
        updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      }
      return
    }

    if (isVariableInput(trimmed)) {
      updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      return
    }

    const { queryParams, requestKey } = buildMarketSearchRequest({
      rawQuery,
      providerId,
      providerConfig,
    })
    requestKeyRef.current = requestKey

    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    updateInstance(instanceId, { isLoading: true, error: undefined })

    const requestPromise = fetchListings(queryParams, controller.signal)

    requestPromise
      .then((rows) => {
        if (requestKeyRef.current !== requestKey || controller.signal.aborted) return
        updateInstance(instanceId, {
          results: rows,
          isLoading: false,
          error: undefined,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        updateInstance(instanceId, {
          isLoading: false,
          error: err instanceof Error ? err.message : 'Search failed',
        })
      })
  }, [
    open,
    query,
    debouncedQuery,
    providerId,
    providerConfig,
    instanceId,
    updateInstance,
    isVariableInput,
  ])
}
