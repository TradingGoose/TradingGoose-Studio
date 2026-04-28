import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import {
  MARKET_QUOTE_SNAPSHOT_REQUEST_CAP,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'

export type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'

export type MarketQuoteSnapshotRequestItem = {
  key: string
  listing: ListingIdentity
}

const chunkItems = (items: MarketQuoteSnapshotRequestItem[]) => {
  const chunks: MarketQuoteSnapshotRequestItem[][] = []
  for (let index = 0; index < items.length; index += MARKET_QUOTE_SNAPSHOT_REQUEST_CAP) {
    chunks.push(items.slice(index, index + MARKET_QUOTE_SNAPSHOT_REQUEST_CAP))
  }
  return chunks
}

type FetchMarketQuoteSnapshotsArgs = {
  workspaceId: string
  provider: string
  items: MarketQuoteSnapshotRequestItem[]
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, unknown>
  signal?: AbortSignal
}

export const fetchMarketQuoteSnapshots = async ({
  workspaceId,
  provider,
  items,
  auth,
  providerParams,
  signal,
}: FetchMarketQuoteSnapshotsArgs): Promise<Record<string, MarketQuoteSnapshot>> => {
  const chunks = chunkItems(items)
  const merged: Record<string, MarketQuoteSnapshot> = {}

  for (const chunk of chunks) {
    const response = await fetch('/api/widgets/market/quotes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        provider,
        items: chunk,
        auth,
        providerParams,
      }),
      signal,
    })

    const payload = (await response.json().catch(() => ({}))) as {
      quotes?: Record<string, MarketQuoteSnapshot>
      error?: string
    }

    if (!response.ok) {
      throw new Error(payload.error || 'Failed to fetch quote snapshots')
    }

    if (payload.quotes) {
      for (const [key, snapshot] of Object.entries(payload.quotes)) {
        if (key in merged) continue
        merged[key] = snapshot
      }
    }
  }

  return merged
}

export type UseMarketQuoteSnapshotsArgs = {
  workspaceId?: string
  provider?: string
  items: Array<{
    key?: string
    listing: ListingIdentity | null | undefined
  }>
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, unknown>
  refreshKey?: number | string | null
  enabled?: boolean
}

export const useMarketQuoteSnapshots = ({
  workspaceId,
  provider,
  items,
  auth,
  providerParams,
  refreshKey,
  enabled = true,
}: UseMarketQuoteSnapshotsArgs) => {
  const normalizedItems = useMemo(() => {
    const seen = new Set<string>()
    const normalized: MarketQuoteSnapshotRequestItem[] = []

    for (const entry of items) {
      const listing = toListingValueObject(entry.listing)
      if (!listing) continue
      const key =
        typeof entry.key === 'string' && entry.key.trim()
          ? entry.key.trim()
          : getListingIdentityKey(listing)
      if (seen.has(key)) continue

      seen.add(key)
      normalized.push({ key, listing })
    }

    return normalized
  }, [items])

  return useQuery({
    queryKey: [
      'market-quote-snapshots',
      workspaceId ?? '',
      provider ?? '',
      stableStringifyJsonValue(normalizedItems),
      auth?.apiKey ?? '',
      auth?.apiSecret ?? '',
      stableStringifyJsonValue(providerParams ?? {}),
      refreshKey ?? '',
    ],
    queryFn: ({ signal }) =>
      fetchMarketQuoteSnapshots({
        workspaceId: workspaceId as string,
        provider: provider as string,
        items: normalizedItems,
        auth,
        providerParams,
        signal,
      }),
    enabled: enabled && Boolean(workspaceId) && Boolean(provider) && normalizedItems.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  })
}
