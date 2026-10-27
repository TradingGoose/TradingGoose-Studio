import { useEffect, useState } from 'react'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import type { ListingIdentity } from '@/lib/listing/identity'
import { getMissingMarketProviderSettings } from '@/lib/market/market-provider-settings'
import {
  createMarketQuoteSnapshot,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { useSocket } from '@/contexts/socket-context'

export type UseMarketQuoteSnapshotsArgs = {
  workspaceId?: string
  provider?: string
  items: Array<{ key: string; listing: ListingIdentity }>
  auth?: { apiKey?: string; apiSecret?: string }
  providerParams?: Record<string, unknown>
  refreshKey?: number | string | null
  enabled?: boolean
}

type QuoteState = {
  scope: string
  data: Record<string, MarketQuoteSnapshot>
  error: Error | null
  pending: number
}

const EMPTY_QUOTES: Record<string, MarketQuoteSnapshot> = {}

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
  const [state, setState] = useState<QuoteState>({
    scope: '',
    data: EMPTY_QUOTES,
    error: null,
    pending: 0,
  })
  const scope = stableStringifyJsonValue([workspaceId, provider, auth, providerParams, items])
  const hasRequest = enabled && Boolean(workspaceId && provider) && items.length > 0
  const missingSettings = hasRequest
    ? getMissingMarketProviderSettings(provider, auth, providerParams)
    : []
  const configurationError = missingSettings.length
    ? `Configure market provider settings: ${missingSettings.join(', ')}`
    : null

  useEffect(() => {
    if (!hasRequest || configurationError || !socket) {
      setState({
        scope,
        data: EMPTY_QUOTES,
        error: hasRequest
          ? new Error(configurationError ?? 'Market data connection is unavailable')
          : null,
        pending: 0,
      })
      return
    }

    const subscriptions = new Map(items.map((item) => [crypto.randomUUID(), item]))
    const pending = new Set<string>()

    const receive = (
      key: string,
      update: (previous?: MarketQuoteSnapshot) => MarketQuoteSnapshot
    ) => {
      pending.delete(key)
      setState((current) => ({
        scope,
        data: { ...current.data, [key]: update(current.data[key]) },
        error: null,
        pending: pending.size,
      }))
    }
    const handleSnapshot = (payload: {
      clientSubscriptionId: string
      snapshot: MarketQuoteSnapshot
    }) => {
      const item = subscriptions.get(payload.clientSubscriptionId)
      if (item) receive(item.key, () => payload.snapshot)
    }
    const handleError = (payload: { clientSubscriptionId: string; message: string }) => {
      const item = subscriptions.get(payload.clientSubscriptionId)
      if (item)
        receive(item.key, (previous) => ({
          ...(previous ?? createMarketQuoteSnapshot({})),
          error: payload.message,
        }))
    }
    const failConnection = (message: string) => {
      pending.clear()
      setState({ scope, data: EMPTY_QUOTES, error: new Error(message), pending: 0 })
    }
    const handleDisconnect = () => failConnection('Market data connection was lost')
    const handleConnectError = () => failConnection('Market data connection failed')
    const subscribe = () => {
      pending.clear()
      for (const item of items) pending.add(item.key)
      setState({
        scope,
        data: EMPTY_QUOTES,
        error: null,
        pending: pending.size,
      })
      for (const [clientSubscriptionId, item] of subscriptions) {
        socket.emit('market-subscribe', {
          provider,
          workspaceId,
          listing: item.listing,
          channel: 'quote-snapshots',
          auth,
          providerParams,
          clientSubscriptionId,
        })
      }
    }

    socket.on('market-quote-snapshot', handleSnapshot)
    socket.on('market-error', handleError)
    socket.on('market-subscribe-error', handleError)
    socket.on('connect', subscribe)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    if (socket.connected) subscribe()
    else failConnection('Market data connection is unavailable')

    return () => {
      socket.off('market-quote-snapshot', handleSnapshot)
      socket.off('market-error', handleError)
      socket.off('market-subscribe-error', handleError)
      socket.off('connect', subscribe)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      for (const clientSubscriptionId of subscriptions.keys()) {
        socket.emit('market-unsubscribe', { clientSubscriptionId })
      }
    }
  }, [scope, hasRequest, configurationError, socket, refreshKey])

  const data =
    hasRequest && !configurationError && state.scope === scope ? state.data : EMPTY_QUOTES
  const isFetching = hasRequest && state.scope === scope && state.pending > 0
  return {
    data,
    error: hasRequest && state.scope === scope ? state.error : null,
    isLoading: isFetching && Object.keys(data).length === 0,
    isFetching,
  }
}
