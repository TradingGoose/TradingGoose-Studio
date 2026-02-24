import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ListingIdentity } from '@/lib/listing/identity'
import { resolveListingKey, toListingValueObject } from '@/lib/listing/identity'

export type WatchlistQuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  error?: string
}

const CHUNK_SIZE = 200

const chunkListings = (listings: ListingIdentity[]) => {
  const chunks: ListingIdentity[][] = []
  for (let index = 0; index < listings.length; index += CHUNK_SIZE) {
    chunks.push(listings.slice(index, index + CHUNK_SIZE))
  }
  return chunks
}

type FetchQuotesArgs = {
  workspaceId: string
  provider: string
  listings: ListingIdentity[]
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, unknown>
}

const fetchWatchlistQuotes = async ({
  workspaceId,
  provider,
  listings,
  auth,
  providerParams,
}: FetchQuotesArgs): Promise<Record<string, WatchlistQuoteSnapshot>> => {
  const chunks = chunkListings(listings)
  const merged: Record<string, WatchlistQuoteSnapshot> = {}

  for (const chunk of chunks) {
    const response = await fetch('/api/watchlists/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        provider,
        listings: chunk,
        auth,
        providerParams,
      }),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      quotes?: Record<string, WatchlistQuoteSnapshot>
      error?: string
    }

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to fetch quote snapshots')
    }

    if (payload.quotes) {
      Object.assign(merged, payload.quotes)
    }
  }

  return merged
}

type UseWatchlistQuotesArgs = {
  workspaceId?: string
  provider?: string
  listings: Array<ListingIdentity | null | undefined>
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, unknown>
  enabled?: boolean
}

export const useWatchlistQuotes = ({
  workspaceId,
  provider,
  listings,
  auth,
  providerParams,
  enabled = true,
}: UseWatchlistQuotesArgs) => {
  const normalizedListings = useMemo(
    () =>
      listings
        .map((entry) => (entry ? toListingValueObject(entry) : null))
        .filter((entry): entry is ListingIdentity => Boolean(entry)),
    [listings]
  )

  const listingKeys = useMemo(
    () =>
      normalizedListings
        .map((listing) => resolveListingKey(listing) ?? '')
        .filter((value) => value.length > 0),
    [normalizedListings]
  )

  return useQuery({
    queryKey: [
      'watchlist-quotes',
      workspaceId ?? '',
      provider ?? '',
      listingKeys.join('|'),
      JSON.stringify(providerParams ?? {}),
    ],
    queryFn: () =>
      fetchWatchlistQuotes({
        workspaceId: workspaceId as string,
        provider: provider as string,
        listings: normalizedListings,
        auth,
        providerParams,
      }),
    enabled: enabled && Boolean(workspaceId) && Boolean(provider) && normalizedListings.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
}
