import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getListingIdentityKey,
  type ListingIdentity,
  type ListingResolved,
} from '@/lib/listing/identity'
import { resolveListingIdentities } from '@/lib/listing/resolve'

type UseResolvedListingsArgs = {
  listings: readonly ListingIdentity[]
  enabled?: boolean
}

export const useResolvedListings = ({ listings, enabled = true }: UseResolvedListingsArgs) => {
  const normalizedListings = useMemo(() => {
    const seen = new Set<string>()
    const next: ListingIdentity[] = []

    for (const listing of listings) {
      const key = getListingIdentityKey(listing)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(listing)
    }

    return next
  }, [listings])

  const listingKey = useMemo(
    () => JSON.stringify(normalizedListings.map(getListingIdentityKey)),
    [normalizedListings]
  )

  return useQuery<Record<string, ListingResolved | null>>({
    queryKey: ['listing-resolution', listingKey],
    queryFn: ({ signal }) => resolveListingIdentities(normalizedListings, signal),
    enabled: enabled && normalizedListings.length > 0,
    staleTime: 5 * 60 * 1000,
  })
}
