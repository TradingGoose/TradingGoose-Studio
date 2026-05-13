import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import {
  getListingIdentityKey,
  type ListingIdentity,
  toListingValueObject,
} from '@/lib/listing/identity'
import type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'
import { useSocket } from '@/contexts/socket-context'

export type { MarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'

type MarketQuoteSnapshotPayload = {
  provider?: string
  channel?: string
  subscriptionId?: string
  clientSubscriptionId?: string
  listing?: ListingIdentity
  snapshot?: MarketQuoteSnapshot
}

type MarketSubscribedPayload = {
  provider?: string
  channel?: string
  subscriptionId?: string
  clientSubscriptionId?: string
  listing?: ListingIdentity
}

type MarketErrorPayload = {
  provider?: string
  channel?: string
  subscriptionId?: string
  clientSubscriptionId?: string
  message?: string
  error?: string
}

const getSnapshotCacheKey = (scopeKey: string, identityKey: string) => `${scopeKey}|${identityKey}`

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
  const { socket } = useSocket()
  const [snapshotsByIdentity, setSnapshotsByIdentity] = useState<
    Record<string, MarketQuoteSnapshot>
  >({})
  const [error, setError] = useState<Error | null>(null)
  const [pendingIdentityCount, setPendingIdentityCount] = useState(0)
  const [refetchNonce, setRefetchNonce] = useState(0)
  const runIdRef = useRef(0)

  const normalizedItems = useMemo(() => {
    const seenKeys = new Set<string>()
    const listingByIdentity = new Map<string, ListingIdentity>()
    const aliasesByIdentity = new Map<string, string[]>()

    for (const entry of items) {
      const listing = toListingValueObject(entry.listing)
      if (!listing) continue
      const identityKey = getListingIdentityKey(listing)
      const key = typeof entry.key === 'string' && entry.key.trim() ? entry.key.trim() : identityKey
      if (seenKeys.has(key)) continue

      seenKeys.add(key)
      if (!listingByIdentity.has(identityKey)) {
        listingByIdentity.set(identityKey, listing)
      }
      const aliases = aliasesByIdentity.get(identityKey) ?? []
      aliases.push(key)
      aliasesByIdentity.set(identityKey, aliases)
    }

    return {
      subscriptions: Array.from(listingByIdentity.entries()).map(([identityKey, listing]) => ({
        identityKey,
        listing,
      })),
      aliasesByIdentity,
    }
  }, [items])

  const subscriptionsKey = useMemo(
    () => stableStringifyJsonValue(normalizedItems.subscriptions),
    [normalizedItems.subscriptions]
  )
  const authKey = stableStringifyJsonValue(auth ?? null)
  const providerParamsKey = stableStringifyJsonValue(providerParams ?? null)
  const subscriptionScopeKey = stableStringifyJsonValue([
    workspaceId ?? null,
    provider ?? null,
    auth ?? null,
    providerParams ?? null,
  ])
  const shouldSubscribe =
    enabled && Boolean(workspaceId) && Boolean(provider) && normalizedItems.subscriptions.length > 0
  const activeSnapshotScopeKey = shouldSubscribe ? subscriptionScopeKey : null

  useEffect(() => {
    if (!shouldSubscribe) {
      setPendingIdentityCount(0)
      setError(null)
      return
    }

    if (!socket) {
      setPendingIdentityCount(normalizedItems.subscriptions.length)
      return
    }

    let disposed = false
    runIdRef.current += 1
    const runId = runIdRef.current
    const receivedIdentities = new Set<string>()
    const subscriptionIds = new Set<string>()
    const acknowledgedClientSubscriptionIds = new Set<string>()
    const identityByClientSubscriptionId = new Map<string, string>()
    const clientSubscriptionIds = normalizedItems.subscriptions.map((item, index) => {
      const clientSubscriptionId = `market-quote:${runId}:${index}:${item.identityKey}`
      identityByClientSubscriptionId.set(clientSubscriptionId, item.identityKey)
      return {
        ...item,
        clientSubscriptionId,
      }
    })

    setPendingIdentityCount(clientSubscriptionIds.length)
    setError(null)

    const markReceived = (identityKey: string) => {
      if (receivedIdentities.has(identityKey)) return
      receivedIdentities.add(identityKey)
      setPendingIdentityCount((current) => Math.max(0, current - 1))
    }

    const resolvePayloadIdentity = (payload: {
      clientSubscriptionId?: string
      listing?: ListingIdentity
    }) => {
      const byClientId = payload.clientSubscriptionId
        ? identityByClientSubscriptionId.get(payload.clientSubscriptionId)
        : undefined
      if (byClientId) return byClientId

      const listing = toListingValueObject(payload.listing)
      return listing ? getListingIdentityKey(listing) : null
    }

    const isRelevantProvider = (payloadProvider?: string) =>
      !payloadProvider || payloadProvider === provider

    const handleSubscribed = (payload: MarketSubscribedPayload) => {
      if (disposed) return
      if (payload.channel !== 'quote-snapshots') return
      if (!isRelevantProvider(payload.provider)) return
      if (!payload.clientSubscriptionId) return
      if (!identityByClientSubscriptionId.has(payload.clientSubscriptionId)) return
      acknowledgedClientSubscriptionIds.add(payload.clientSubscriptionId)
      if (payload.subscriptionId) {
        subscriptionIds.add(payload.subscriptionId)
      }
    }

    const handleSnapshot = (payload: MarketQuoteSnapshotPayload) => {
      if (disposed) return
      if (payload.channel !== 'quote-snapshots') return
      if (!isRelevantProvider(payload.provider)) return
      if (!payload.snapshot) return
      const identityKey = resolvePayloadIdentity(payload)
      if (!identityKey) return

      setSnapshotsByIdentity((current) => ({
        ...current,
        [getSnapshotCacheKey(subscriptionScopeKey, identityKey)]:
          payload.snapshot as MarketQuoteSnapshot,
      }))
      markReceived(identityKey)
    }

    const handleError = (payload: MarketErrorPayload) => {
      if (disposed) return
      if (payload.channel && payload.channel !== 'quote-snapshots') return
      if (!isRelevantProvider(payload.provider)) return
      if (
        payload.clientSubscriptionId &&
        !identityByClientSubscriptionId.has(payload.clientSubscriptionId)
      ) {
        return
      }

      const message =
        typeof payload.message === 'string' && payload.message.trim()
          ? payload.message
          : typeof payload.error === 'string' && payload.error.trim()
            ? payload.error
            : 'Failed to subscribe to market quotes'
      setError(new Error(message))
      const identityKey = resolvePayloadIdentity(payload)
      if (identityKey) markReceived(identityKey)
    }

    const subscribeAll = () => {
      subscriptionIds.clear()
      for (const item of clientSubscriptionIds) {
        socket.emit('market-subscribe', {
          provider,
          workspaceId,
          listing: item.listing,
          channel: 'quote-snapshots',
          auth,
          providerParams,
          clientSubscriptionId: item.clientSubscriptionId,
        })
      }
    }

    socket.on('market-subscribed', handleSubscribed)
    socket.on('market-quote-snapshot', handleSnapshot)
    socket.on('market-error', handleError)
    socket.on('market-subscribe-error', handleError)
    socket.on('connect', subscribeAll)
    subscribeAll()

    return () => {
      disposed = true
      socket.off('market-subscribed', handleSubscribed)
      socket.off('market-quote-snapshot', handleSnapshot)
      socket.off('market-error', handleError)
      socket.off('market-subscribe-error', handleError)
      socket.off('connect', subscribeAll)
      for (const subscriptionId of subscriptionIds) {
        socket.emit('market-unsubscribe', { subscriptionId })
      }
      for (const item of clientSubscriptionIds) {
        if (acknowledgedClientSubscriptionIds.has(item.clientSubscriptionId)) continue
        socket.emit('market-unsubscribe', {
          provider,
          clientSubscriptionId: item.clientSubscriptionId,
        })
      }
    }
  }, [
    authKey,
    enabled,
    provider,
    providerParamsKey,
    refetchNonce,
    refreshKey,
    shouldSubscribe,
    socket,
    subscriptionScopeKey,
    subscriptionsKey,
    workspaceId,
  ])

  const data = useMemo(() => {
    if (!activeSnapshotScopeKey) return {}
    const quotes: Record<string, MarketQuoteSnapshot> = {}
    normalizedItems.aliasesByIdentity.forEach((aliases, identityKey) => {
      const snapshot = snapshotsByIdentity[getSnapshotCacheKey(activeSnapshotScopeKey, identityKey)]
      if (!snapshot) return
      aliases.forEach((key) => {
        quotes[key] = snapshot
      })
    })
    return quotes
  }, [activeSnapshotScopeKey, normalizedItems.aliasesByIdentity, snapshotsByIdentity])

  const refetch = useCallback(async () => {
    setRefetchNonce((current) => current + 1)
    return { data }
  }, [data])

  const isFetching = shouldSubscribe && pendingIdentityCount > 0

  return {
    data,
    error,
    isLoading: isFetching && Object.keys(data).length === 0,
    isFetching,
    refetch,
  }
}
