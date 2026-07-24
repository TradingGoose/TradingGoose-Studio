import { useEffect, useMemo, useRef } from 'react'
import { buildMarketSearchRequest } from '@/components/listing-selector/selector/search-request'
import {
  combineProviderSearchConfigs,
  useMarketProviderSearchConfig,
  useTradingProviderSearchConfig,
} from '@/components/listing-selector/selector/use-provider-config'
import type { ListingOption } from '@/lib/listing/identity'
import { fetchListings } from '@/lib/listing/search'
import { useDebounce } from '@/hooks/use-debounce'
import type { ListingSelectorInstance } from '@/stores/market/selector/store'

type UpdateInstance = (id: string, patch: Partial<ListingSelectorInstance>) => void

type UseMarketListingSearchOptions = {
  open: boolean
  query: string
  providerId?: string
  providerType?: 'market' | 'trading'
  marketProviderId?: string
  tradingProviderId?: string
  assetClassFilter?: string | null
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

const listingMatchesAssetClass = (
  listing: ListingOption,
  assetClassFilter?: string | null
): boolean => {
  if (!assetClassFilter) return true
  const normalizedFilter = assetClassFilter.trim().toLowerCase()
  const listingAssetClass = listing.assetClass?.trim().toLowerCase()
  if (listingAssetClass) return listingAssetClass === normalizedFilter
  return listing.listing_type === normalizedFilter
}

export function useMarketListingSearch({
  open,
  query,
  providerId,
  providerType = 'market',
  marketProviderId,
  tradingProviderId,
  assetClassFilter,
  instanceId,
  updateInstance,
  candidateListings,
  candidateListingsLoading = false,
  candidateListingsError,
}: UseMarketListingSearchOptions) {
  const debouncedQuery = useDebounce(query, 400)
  const requestKeyRef = useRef<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const marketSearchProviderId =
    marketProviderId ?? (providerType === 'market' ? providerId : undefined)
  const tradingSearchProviderId =
    tradingProviderId ?? (providerType === 'trading' ? providerId : undefined)
  const marketProviderConfig = useMarketProviderSearchConfig(marketSearchProviderId)
  const tradingProviderConfig = useTradingProviderSearchConfig(tradingSearchProviderId)
  const providerConfig = useMemo(
    () =>
      combineProviderSearchConfigs([
        ...(marketSearchProviderId ? [marketProviderConfig] : []),
        ...(tradingSearchProviderId ? [tradingProviderConfig] : []),
      ]),
    [marketSearchProviderId, marketProviderConfig, tradingSearchProviderId, tradingProviderConfig]
  )

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
        results: candidateListings.filter(
          (listing) =>
            listingMatchesAssetClass(listing, assetClassFilter) &&
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
      providerConfig,
      assetClassFilter,
    })
    if (Object.keys(queryParams).length === 0) {
      abortInFlightRequest()
      updateInstance(instanceId, { results: [], isLoading: false, error: undefined })
      return
    }

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
    marketProviderId,
    tradingProviderId,
    assetClassFilter,
    providerConfig,
    instanceId,
    updateInstance,
    candidateListings,
    candidateListingsLoading,
    candidateListingsError,
  ])
}
