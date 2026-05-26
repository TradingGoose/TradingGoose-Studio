import { useEffect, useRef } from 'react'
import { fetchListings } from '@/components/listing-selector/fetchers'
import { buildMarketSearchRequest } from '@/components/listing-selector/selector/search-request'
import {
  useMarketProviderSearchConfig,
  useTradingProviderSearchConfig,
} from '@/components/listing-selector/selector/use-provider-config'
import type { ListingOption } from '@/lib/listing/identity'
import { useDebounce } from '@/hooks/use-debounce'
import type { ListingSelectorInstance } from '@/stores/market/selector/store'

type UpdateInstance = (id: string, patch: Partial<ListingSelectorInstance>) => void

type UseMarketListingSearchOptions = {
  open: boolean
  query: string
  providerId?: string
  providerType?: 'market' | 'trading'
  instanceId: string
  updateInstance: UpdateInstance
  candidateListings?: ListingOption[]
  candidateListingsLoading?: boolean
  candidateListingsError?: string
}

const listingMatchesQuery = (listing: ListingOption, query: string): boolean => {
  if (!query) return true
  return [
    listing.base,
    listing.quote,
    listing.name,
    listing.assetClass,
    listing.listing_id,
    listing.base_id,
    listing.quote_id,
    listing.listing_type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query)
}

export function useMarketListingSearch({
  open,
  query,
  providerId,
  providerType = 'market',
  instanceId,
  updateInstance,
  candidateListings,
  candidateListingsLoading = false,
  candidateListingsError,
}: UseMarketListingSearchOptions) {
  const debouncedQuery = useDebounce(query, 400)
  const requestKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const marketProviderConfig = useMarketProviderSearchConfig(providerId)
  const tradingProviderConfig = useTradingProviderSearchConfig(providerId)
  const providerConfig = providerType === 'trading' ? tradingProviderConfig : marketProviderConfig

  const abortInFlightRequest = () => {
    requestKeyRef.current = ''
    if (!abortRef.current) {
      return
    }
    abortRef.current.abort()
    abortRef.current = null
  }

  useEffect(() => {
    const trimmedQuery = query.trim()
    const trimmedDebouncedQuery = debouncedQuery.trim()

    if (!open) {
      abortInFlightRequest()
      updateInstance(
        instanceId,
        trimmedQuery
          ? { isLoading: false, error: undefined }
          : { results: [], isLoading: false, error: undefined }
      )
      return
    }

    if (trimmedQuery.startsWith('<')) {
      abortInFlightRequest()
      updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      return
    }

    if (candidateListings) {
      abortInFlightRequest()
      if (candidateListingsLoading) {
        updateInstance(instanceId, { results: [], isLoading: true, error: undefined })
        return
      }

      updateInstance(instanceId, {
        results: candidateListings.filter((listing) =>
          listingMatchesQuery(listing, trimmedQuery.toLowerCase())
        ),
        isLoading: false,
        error: candidateListingsError,
      })
      return
    }

    if (trimmedDebouncedQuery !== trimmedQuery) {
      abortInFlightRequest()
      updateInstance(instanceId, {
        isLoading: true,
        error: undefined,
      })
      return
    }

    const { queryParams, requestKey } = buildMarketSearchRequest({
      rawQuery: debouncedQuery,
      providerId,
      providerType,
      providerConfig,
    })
    requestKeyRef.current = requestKey

    abortInFlightRequest()
    requestKeyRef.current = requestKey
    const controller = new AbortController()
    abortRef.current = controller

    updateInstance(instanceId, { isLoading: true, error: undefined })

    const requestPromise = fetchListings(queryParams, controller.signal)

    requestPromise
      .then((rows) => {
        if (requestKeyRef.current !== requestKey || controller.signal.aborted) return
        if (abortRef.current === controller) {
          abortRef.current = null
        }
        updateInstance(instanceId, {
          results: rows,
          isLoading: false,
          error: undefined,
        })
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (abortRef.current === controller) {
          abortRef.current = null
        }
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
    providerType,
    providerConfig,
    instanceId,
    updateInstance,
    candidateListings,
    candidateListingsLoading,
    candidateListingsError,
  ])
}
