import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ListingIdentity } from '@/lib/listing/identity'
import { toListingValueObject } from '@/lib/listing/identity'

export type WatchlistQuoteSnapshot = {
  lastPrice: number | null
  change: number | null
  changePercent: number | null
  previousClose: number | null
  error?: string
}

const CHUNK_SIZE = 200

export type WatchlistQuoteRequestItem = {
  itemId: string
  listing: ListingIdentity
}

const chunkItems = (items: WatchlistQuoteRequestItem[]) => {
  const chunks: WatchlistQuoteRequestItem[][] = []
  for (let index = 0; index < items.length; index += CHUNK_SIZE) {
    chunks.push(items.slice(index, index + CHUNK_SIZE))
  }
  return chunks
}

type FetchQuotesArgs = {
  workspaceId: string
  provider: string
  items: WatchlistQuoteRequestItem[]
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, unknown>
}

const fetchWatchlistQuotes = async ({
  workspaceId,
  provider,
  items,
  auth,
  providerParams,
}: FetchQuotesArgs): Promise<Record<string, WatchlistQuoteSnapshot>> => {
  const chunks = chunkItems(items)
  const merged: Record<string, WatchlistQuoteSnapshot> = {}

  for (const chunk of chunks) {
    const response = await fetch('/api/watchlists/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        provider,
        items: chunk,
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
  items: Array<{
    itemId: string
    listing: ListingIdentity | null | undefined
  }>
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
  items,
  auth,
  providerParams,
  enabled = true,
}: UseWatchlistQuotesArgs) => {
  const normalizedItems = useMemo(() => {
    const seen = new Set<string>()
    const normalized: WatchlistQuoteRequestItem[] = []

    for (const entry of items) {
      const itemId = entry.itemId.trim()
      if (!itemId || seen.has(itemId)) continue
      const listing = toListingValueObject(entry.listing)
      if (!listing) continue

      seen.add(itemId)
      normalized.push({ itemId, listing })
    }

    return normalized
  }, [items])

  return useQuery({
    queryKey: [
      'watchlist-quotes',
      workspaceId ?? '',
      provider ?? '',
      JSON.stringify(normalizedItems),
      auth?.apiKey ?? '',
      auth?.apiSecret ?? '',
      JSON.stringify(providerParams ?? {}),
    ],
    queryFn: () =>
      fetchWatchlistQuotes({
        workspaceId: workspaceId as string,
        provider: provider as string,
        items: normalizedItems,
        auth,
        providerParams,
      }),
    enabled: enabled && Boolean(workspaceId) && Boolean(provider) && normalizedItems.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
}
