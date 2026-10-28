import { useEffect, useRef, useState } from 'react'
import { useLocale, useMessages } from 'next-intl'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { getMissingMarketProviderSettings } from '@/lib/market/market-provider-settings'
import {
  createMarketQuoteSnapshot,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { useSocket } from '@/contexts/socket-context'
import { formatTemplate, type LocaleCode } from '@/i18n/utils'

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
}

type QuoteSubscription = {
  listing: ListingIdentity
  clientSubscriptionId: string
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
  const locale = useLocale() as LocaleCode
  const copy = useMessages().workspace.widgets.marketQuotes
  const records = useRef(new Map<string, QuoteSubscription>()).current
  const [state, setState] = useState<QuoteState>({
    scope: '',
    data: EMPTY_QUOTES,
    error: null,
  })
  const scope = stableStringifyJsonValue([workspaceId, provider, auth, providerParams, refreshKey])
  const hasRequest = enabled && Boolean(workspaceId && provider) && items.length > 0
  const missingSettings = hasRequest
    ? getMissingMarketProviderSettings(provider, auth, providerParams)
    : []
  const configurationError = missingSettings.length ? 'marketQuotes.configureProvider' : null
  const localizeError = (message: string) => {
    const key = message.slice('marketQuotes.'.length)
    return message.startsWith('marketQuotes.') && Object.hasOwn(copy, key)
      ? formatTemplate(
          copy[key as keyof typeof copy],
          { settings: missingSettings.join(', ') },
          locale
        )
      : message
  }
  const subscribe = (record: QuoteSubscription) => {
    if (socket?.connected)
      socket.emit('market-subscribe', {
        provider,
        workspaceId,
        listing: record.listing,
        channel: 'quote-snapshots',
        auth,
        providerParams,
        clientSubscriptionId: record.clientSubscriptionId,
      })
  }
  const unsubscribe = (record: QuoteSubscription) => {
    if (socket?.connected)
      socket.emit('market-unsubscribe', { clientSubscriptionId: record.clientSubscriptionId })
  }

  useEffect(() => {
    const reset = (message: string | null = null) =>
      setState({
        scope,
        data: EMPTY_QUOTES,
        error: message ? new Error(message) : null,
      })
    reset(
      hasRequest
        ? (configurationError ?? (!socket?.connected ? 'marketQuotes.connectionUnavailable' : null))
        : null
    )
    if (!hasRequest || configurationError || !socket) return

    const receive = (
      clientSubscriptionId: string,
      update: (previous?: MarketQuoteSnapshot) => MarketQuoteSnapshot
    ) => {
      for (const [key, record] of records) {
        if (record.clientSubscriptionId !== clientSubscriptionId) continue
        setState((current) =>
          current.scope === scope && !current.error && records.get(key) === record
            ? { ...current, data: { ...current.data, [key]: update(current.data[key]) } }
            : current
        )
        break
      }
    }
    const handleSnapshot = (payload: {
      clientSubscriptionId: string
      snapshot: MarketQuoteSnapshot
    }) => {
      receive(payload.clientSubscriptionId, () => payload.snapshot)
    }
    const handleError = (payload: { clientSubscriptionId: string; message: string }) => {
      receive(payload.clientSubscriptionId, (previous) => ({
        ...(previous ?? createMarketQuoteSnapshot({})),
        error: payload.message,
      }))
    }
    const handleDisconnect = () => reset('marketQuotes.connectionLost')
    const handleConnectError = () => reset('marketQuotes.connectionFailed')
    const handleConnect = () => {
      records.forEach((record, key) =>
        records.set(key, { ...record, clientSubscriptionId: crypto.randomUUID() })
      )
      reset()
      records.forEach(subscribe)
    }
    socket.on('market-quote-snapshot', handleSnapshot)
    socket.on('market-error', handleError)
    socket.on('market-subscribe-error', handleError)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)

    return () => {
      const active = Array.from(records.values())
      records.clear()
      socket.off('market-quote-snapshot', handleSnapshot)
      socket.off('market-error', handleError)
      socket.off('market-subscribe-error', handleError)
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      active.forEach(unsubscribe)
    }
  }, [scope, hasRequest, configurationError, socket])

  useEffect(() => {
    if (!hasRequest || configurationError || !socket) return
    const wanted = new Map(items.map((item) => [item.key, item.listing]))
    const removed: string[] = []
    records.forEach((record, key) => {
      if (areListingIdentitiesEqual(record.listing, wanted.get(key))) return
      records.delete(key)
      removed.push(key)
      unsubscribe(record)
    })
    if (removed.length) {
      setState((current) => {
        if (current.scope !== scope) return current
        const data = { ...current.data }
        for (const key of removed) delete data[key]
        return { ...current, data }
      })
    }
    wanted.forEach((listing, key) => {
      if (records.has(key)) return
      const record = {
        listing,
        clientSubscriptionId: crypto.randomUUID(),
      }
      records.set(key, record)
      subscribe(record)
    })
  }, [items, scope, hasRequest, configurationError, socket])

  const active = hasRequest && !configurationError && state.scope === scope
  const data = active
    ? Object.fromEntries(
        items.flatMap(({ key, listing }) => {
          const quote = state.data[key]
          return quote && areListingIdentitiesEqual(records.get(key)?.listing, listing)
            ? [[key, quote.error ? { ...quote, error: localizeError(quote.error) } : quote]]
            : []
        })
      )
    : EMPTY_QUOTES
  const isFetching = active && !state.error && items.some(({ key }) => !data[key])
  return {
    data,
    error:
      hasRequest && state.scope === scope && state.error
        ? new Error(localizeError(state.error.message))
        : null,
    isLoading: isFetching && Object.keys(data).length === 0,
    isFetching,
  }
}
