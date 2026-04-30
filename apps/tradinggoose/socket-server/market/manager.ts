import { createHash, randomUUID } from 'crypto'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { areListingIdentitiesEqual, type ListingIdentity } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import {
  createEmptyMarketQuoteSnapshot,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import {
  getMarketLiveCapabilities,
  getMarketProviderConfig,
} from '@/providers/market/providers'
import type { MarketBar, MarketProviderAuth, MarketProviderParams } from '@/providers/market/types'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import {
  type AlpacaCryptoRegion,
  type AlpacaFeed,
  type AlpacaMarket,
  AlpacaMarketStream,
} from './alpaca'
import { FinnhubMarketStream } from './finnhub'

const logger = createLogger('MarketStreamManager')
const DEFAULT_POLLING_INTERVAL_MS = 15_000
const MIN_POLLING_INTERVAL_MS = 5_000
const POLLING_CONCURRENCY = 5

export type MarketProviderId = 'alpaca' | 'finnhub'
export type PollingMarketProviderId = 'alpha-vantage' | 'yahoo-finance'
export type AnyMarketProviderId = MarketProviderId | PollingMarketProviderId
export type MarketStreamChannel = 'bars' | 'trades' | 'quotes'
export type MarketChannel = MarketStreamChannel | 'quote-snapshots'

export interface MarketSubscribePayload {
  provider?: AnyMarketProviderId
  clientSubscriptionId?: string
  workspaceId?: string
  listing?: ListingIdentity
  channel?: MarketChannel
  interval?: string
  market?: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  auth?: {
    apiKey?: string
    apiSecret?: string
  }
  providerParams?: Record<string, any>
}

export interface MarketUnsubscribePayload {
  subscriptionId?: string
  clientSubscriptionId?: string
  listing?: ListingIdentity
  symbol?: string
  provider?: AnyMarketProviderId
}

export interface MarketSubscriptionInfo {
  subscriptionId: string
  clientSubscriptionId?: string
  listing: ListingIdentity | null
  symbol: string
  provider: AnyMarketProviderId
  market: AlpacaMarket
  channel: MarketChannel
  interval?: string
}

interface MarketSubscriptionRecord extends MarketSubscriptionInfo {
  streamKey: string
  socketId: string
  socket: AuthenticatedSocket
  upstreamChannel?: MarketStreamChannel
  listingBase?: string
  listingQuote?: string
}

type MarketStream = {
  subscribe: (symbols: string[], channel?: MarketStreamChannel) => void
  unsubscribe: (symbols: string[], channel?: MarketStreamChannel) => void
  close: () => void
}

interface StreamState {
  stream?: MarketStream
  provider: AnyMarketProviderId
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  auth?: MarketProviderAuth
  providerParams?: MarketProviderParams
  pollingTimer?: ReturnType<typeof setInterval>
  pollingInFlight?: boolean
  pollingIntervalMs?: number
  quoteSnapshotCache: Map<string, MarketQuoteSnapshot>
  subscribersBySymbol: Map<string, Map<string, MarketSubscriptionRecord>>
}

export class MarketStreamManager {
  private streams = new Map<string, StreamState>()
  private socketSubscriptions = new Map<string, Map<string, MarketSubscriptionRecord>>()

  async subscribe(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload
  ): Promise<MarketSubscriptionInfo> {
    const resolvedPayload = await resolveMarketSubscribeEnv(payload, socket.userId)
    const provider = resolveProviderId(resolvedPayload.provider)

    if (provider === 'alpaca') {
      return this.subscribeAlpaca(socket, { ...resolvedPayload, provider })
    }

    if (provider === 'finnhub') {
      return this.subscribeFinnhub(socket, { ...resolvedPayload, provider })
    }

    return this.subscribePollingProvider(socket, { ...resolvedPayload, provider })
  }

  unsubscribe(
    socket: AuthenticatedSocket,
    payload: MarketUnsubscribePayload
  ): MarketSubscriptionInfo[] {
    const socketMap = this.socketSubscriptions.get(socket.id)
    if (!socketMap || socketMap.size === 0) {
      return []
    }

    const matches = this.findMatchingSubscriptions(socketMap, payload)
    if (!matches.length) {
      return []
    }

    matches.forEach((record) => this.removeRecord(record))

    return matches.map((record) => ({
      subscriptionId: record.subscriptionId,
      clientSubscriptionId: record.clientSubscriptionId,
      listing: record.listing,
      symbol: record.symbol,
      provider: record.provider,
      market: record.market,
      channel: record.channel,
      interval: record.interval,
    }))
  }

  removeSocket(socketId: string) {
    const socketMap = this.socketSubscriptions.get(socketId)
    if (!socketMap) return

    socketMap.forEach((record) => this.removeRecord(record))
  }

  private async subscribeAlpaca(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload
  ): Promise<MarketSubscriptionInfo> {
    const listing = payload.listing
    if (!listing) {
      throw new Error('listing is required to subscribe to market data')
    }

    const channel = payload.channel ?? 'bars'
    if (
      channel !== 'bars' &&
      channel !== 'trades' &&
      channel !== 'quotes' &&
      channel !== 'quote-snapshots'
    ) {
      throw new Error('Unsupported Alpaca channel')
    }
    const upstreamChannel = resolveUpstreamChannel(channel)

    const context = await resolveListingContext(listing)
    const market = resolveMarket(payload, context.assetClass)

    if (market === 'crypto' && !context.quote) {
      throw new Error('Crypto listings require a quote currency for Alpaca symbols')
    }

    const symbol = normalizeSymbol(resolveProviderSymbol(alpacaProviderConfig, context))
    if (!symbol) {
      throw new Error('Failed to resolve provider symbol for listing')
    }

    const feed = resolveFeed(payload, market)
    const cryptoRegion = resolveCryptoRegion(payload)
    const { keyId, secretKey } = resolveAlpacaCredentials(payload)

    if (!keyId || !secretKey) {
      throw new Error('Alpaca ApiKey and ApiSecret are required for streaming')
    }

    const streamKey = buildAlpacaStreamKey({
      provider: 'alpaca',
      workspaceId: payload.workspaceId,
      market,
      feed,
      cryptoRegion,
      keyId,
      secretKey,
    })

    const streamState = this.getOrCreateStream(streamKey, {
      provider: 'alpaca',
      market,
      feed,
      cryptoRegion,
      keyId,
      secretKey,
      auth: {
        apiKey: keyId,
        apiSecret: secretKey,
      },
      providerParams: payload.providerParams,
    })

    const intervalToken =
      typeof payload.interval === 'string' && payload.interval.trim()
        ? payload.interval.trim()
        : 'na'
    const subscriptionId = createSubscriptionId({
      streamKey,
      channel,
      symbol,
      interval: intervalToken,
      clientSubscriptionId: payload.clientSubscriptionId,
    })
    const record: MarketSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      streamKey,
      listing,
      socketId: socket.id,
      socket,
      symbol,
      provider: 'alpaca',
      market,
      channel,
      upstreamChannel,
      interval: payload.interval,
      listingBase: context.base,
      listingQuote: context.quote,
    }

    this.addSubscription(streamState, record)

    logger.info('Market subscription added', {
      socketId: socket.id,
      userId: socket.userId,
      provider: 'alpaca',
      listing,
      symbol,
      market,
      channel,
    })

    return {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      listing,
      symbol,
      provider: 'alpaca',
      market,
      channel,
      interval: payload.interval,
    }
  }

  private async subscribeFinnhub(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload
  ): Promise<MarketSubscriptionInfo> {
    const listing = payload.listing
    if (!listing) {
      throw new Error('listing is required to subscribe to market data')
    }

    const channel = payload.channel ?? 'trades'
    if (channel !== 'bars' && channel !== 'trades' && channel !== 'quote-snapshots') {
      throw new Error('Finnhub streaming supports bars and trades only')
    }
    const upstreamChannel = resolveUpstreamChannel(channel)

    const context = await resolveListingContext(listing)
    const market = resolveMarket(payload, context.assetClass)

    if (market === 'crypto' && !context.quote) {
      throw new Error('Crypto listings require a quote currency for Finnhub symbols')
    }

    const symbol = normalizeSymbol(resolveProviderSymbol(finnhubProviderConfig, context))
    if (!symbol) {
      throw new Error('Failed to resolve provider symbol for listing')
    }

    const apiKey = resolveFinnhubApiKey(payload)
    if (!apiKey) {
      throw new Error('Finnhub API key is required for streaming')
    }

    const streamKey = buildFinnhubStreamKey({
      provider: 'finnhub',
      workspaceId: payload.workspaceId,
      apiKey,
    })
    const streamState = this.getOrCreateStream(streamKey, {
      provider: 'finnhub',
      market,
      apiKey,
      auth: {
        apiKey,
      },
      providerParams: payload.providerParams,
    })

    const intervalToken =
      typeof payload.interval === 'string' && payload.interval.trim()
        ? payload.interval.trim()
        : 'na'
    const subscriptionId = createSubscriptionId({
      streamKey,
      channel,
      symbol,
      interval: intervalToken,
      clientSubscriptionId: payload.clientSubscriptionId,
    })
    const record: MarketSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      streamKey,
      listing,
      socketId: socket.id,
      socket,
      symbol,
      provider: 'finnhub',
      market,
      channel,
      upstreamChannel,
      interval: payload.interval,
      listingBase: context.base,
      listingQuote: context.quote,
    }

    this.addSubscription(streamState, record)

    logger.info('Market subscription added', {
      socketId: socket.id,
      userId: socket.userId,
      provider: 'finnhub',
      listing,
      symbol,
      market,
      channel,
    })

    return {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      listing,
      symbol,
      provider: 'finnhub',
      market,
      channel,
      interval: payload.interval,
    }
  }

  private async subscribePollingProvider(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload & { provider: PollingMarketProviderId }
  ): Promise<MarketSubscriptionInfo> {
    const listing = payload.listing
    if (!listing) {
      throw new Error('listing is required to subscribe to market data')
    }

    const channel = payload.channel ?? 'quote-snapshots'
    if (channel !== 'quote-snapshots') {
      throw new Error('Polling market providers support quote snapshots only')
    }

    const capabilities = getMarketLiveCapabilities(payload.provider)
    if (!capabilities?.supportsPolling) {
      throw new Error(`Provider ${payload.provider} does not support polling market streams`)
    }

    const providerConfig = getMarketProviderConfig(payload.provider)
    if (!providerConfig) {
      throw new Error(`Market provider not found: ${payload.provider}`)
    }

    const context = await resolveListingContext(listing)
    const market = resolveMarket(payload, context.assetClass)
    const symbol = normalizeSymbol(resolveProviderSymbol(providerConfig, context))
    if (!symbol) {
      throw new Error('Failed to resolve provider symbol for listing')
    }

    const streamKey = buildPollingStreamKey({
      provider: payload.provider,
      workspaceId: payload.workspaceId,
      auth: payload.auth,
      providerParams: payload.providerParams,
    })
    const streamState = this.getOrCreatePollingStream(streamKey, {
      provider: payload.provider,
      auth: payload.auth,
      providerParams: payload.providerParams,
      pollingIntervalMs: resolvePollingIntervalMs(payload.provider, payload.providerParams),
    })

    const intervalToken =
      typeof payload.interval === 'string' && payload.interval.trim()
        ? payload.interval.trim()
        : 'na'
    const subscriptionId = createSubscriptionId({
      streamKey,
      channel,
      symbol,
      interval: intervalToken,
      clientSubscriptionId: payload.clientSubscriptionId,
    })
    const record: MarketSubscriptionRecord = {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      streamKey,
      listing,
      socketId: socket.id,
      socket,
      symbol,
      provider: payload.provider,
      market,
      channel,
      interval: payload.interval,
      listingBase: context.base,
      listingQuote: context.quote,
    }

    this.addSubscription(streamState, record)

    logger.info('Polling market subscription added', {
      socketId: socket.id,
      userId: socket.userId,
      provider: payload.provider,
      listing,
      symbol,
      channel,
    })

    return {
      subscriptionId,
      clientSubscriptionId: payload.clientSubscriptionId,
      listing,
      symbol,
      provider: payload.provider,
      market,
      channel,
      interval: payload.interval,
    }
  }

  private addSubscription(streamState: StreamState, record: MarketSubscriptionRecord) {
    const symbolSubscribers =
      streamState.subscribersBySymbol.get(record.symbol) ??
      new Map<string, MarketSubscriptionRecord>()

    const hadUpstreamChannel =
      record.upstreamChannel === undefined
        ? true
        : Array.from(symbolSubscribers.values()).some(
            (existing) => existing.upstreamChannel === record.upstreamChannel
          )

    if (!symbolSubscribers.has(record.subscriptionId)) {
      symbolSubscribers.set(record.subscriptionId, record)
      streamState.subscribersBySymbol.set(record.symbol, symbolSubscribers)

      if (!hadUpstreamChannel && record.upstreamChannel) {
        streamState.stream?.subscribe([record.symbol], record.upstreamChannel)
      }
    }

    const socketMap = this.socketSubscriptions.get(record.socketId) ?? new Map()
    socketMap.set(record.subscriptionId, record)
    this.socketSubscriptions.set(record.socketId, socketMap)

    if (record.channel === 'quote-snapshots') {
      const cached = streamState.quoteSnapshotCache.get(record.symbol)
      if (cached) {
        this.emitQuoteSnapshot(record, cached)
      }
    }

    if (!streamState.stream) {
      this.ensurePolling(streamState)
    }
  }

  private getOrCreateStream(
    streamKey: string,
    config: {
      provider: MarketProviderId
      market: AlpacaMarket
      feed?: AlpacaFeed
      cryptoRegion?: AlpacaCryptoRegion
      keyId?: string
      secretKey?: string
      apiKey?: string
      auth?: MarketProviderAuth
      providerParams?: MarketProviderParams
    }
  ): StreamState {
    const existing = this.streams.get(streamKey)
    if (existing) return existing

    const stream =
      config.provider === 'alpaca'
        ? new AlpacaMarketStream(
            {
              market: config.market,
              feed: config.feed,
              cryptoRegion: config.cryptoRegion,
              keyId: config.keyId,
              secretKey: config.secretKey,
            },
            {
              onBar: ({ symbol, bar, raw }) => this.handleBar(streamKey, symbol, bar, raw),
              onTrade: ({ symbol, trade, raw }) => this.handleTrade(streamKey, symbol, trade, raw),
              onQuote: ({ symbol, quote, raw }) => this.handleQuote(streamKey, symbol, quote, raw),
              onError: (payload) =>
                this.handleStreamError(streamKey, payload.message, payload.detail),
            }
          )
        : new FinnhubMarketStream(
            {
              apiKey: config.apiKey,
            },
            {
              onBar: ({ symbol, bar, raw }) => this.handleBar(streamKey, symbol, bar, raw),
              onTrade: ({ symbol, trade, raw }) => this.handleTrade(streamKey, symbol, trade, raw),
              onError: (payload) =>
                this.handleStreamError(streamKey, payload.message, payload.detail),
            }
          )

    const state: StreamState = {
      stream,
      provider: config.provider,
      market: config.market,
      feed: config.feed,
      cryptoRegion: config.cryptoRegion,
      auth: config.auth,
      providerParams: config.providerParams,
      quoteSnapshotCache: new Map(),
      subscribersBySymbol: new Map(),
    }

    this.streams.set(streamKey, state)
    return state
  }

  private getOrCreatePollingStream(
    streamKey: string,
    config: {
      provider: PollingMarketProviderId
      auth?: MarketProviderAuth
      providerParams?: MarketProviderParams
      pollingIntervalMs: number
    }
  ): StreamState {
    const existing = this.streams.get(streamKey)
    if (existing) return existing

    const state: StreamState = {
      provider: config.provider,
      market: 'stocks',
      auth: config.auth,
      providerParams: config.providerParams,
      pollingIntervalMs: config.pollingIntervalMs,
      quoteSnapshotCache: new Map(),
      subscribersBySymbol: new Map(),
    }

    this.streams.set(streamKey, state)
    return state
  }

  private handleBar(streamKey: string, symbol: string, bar: MarketBar, raw: any) {
    const state = this.streams.get(streamKey)
    if (!state) return

    const subscribers = state.subscribersBySymbol.get(symbol)
    if (!subscribers || subscribers.size === 0) return

    subscribers.forEach((record) => {
      if (record.channel !== 'bars') return
      record.socket.emit('market-bar', {
        provider: record.provider,
        market: record.market,
        channel: record.channel,
        subscriptionId: record.subscriptionId,
        listing: record.listing,
        listingBase: record.listingBase,
        listingQuote: record.listingQuote,
        symbol: record.symbol,
        interval: record.interval,
        bar,
        receivedAt: new Date().toISOString(),
        raw,
      })
    })
  }

  private handleTrade(streamKey: string, symbol: string, trade: any, raw: any) {
    const state = this.streams.get(streamKey)
    if (!state) return

    const subscribers = state.subscribersBySymbol.get(symbol)
    if (!subscribers || subscribers.size === 0) return

    let quoteSnapshot: MarketQuoteSnapshot | null = null

    subscribers.forEach((record) => {
      if (record.channel === 'quote-snapshots') {
        if (!quoteSnapshot) {
          quoteSnapshot = updateSnapshotFromTrade(state.quoteSnapshotCache.get(symbol), trade)
          state.quoteSnapshotCache.set(symbol, quoteSnapshot)
        }
        this.emitQuoteSnapshot(record, quoteSnapshot, raw)
        return
      }

      if (record.channel !== 'trades') return
      record.socket.emit('market-trade', {
        provider: record.provider,
        market: record.market,
        channel: record.channel,
        subscriptionId: record.subscriptionId,
        listing: record.listing,
        listingBase: record.listingBase,
        listingQuote: record.listingQuote,
        symbol: record.symbol,
        interval: record.interval,
        trade,
        receivedAt: new Date().toISOString(),
        raw,
      })
    })
  }

  private handleQuote(streamKey: string, symbol: string, quote: any, raw: any) {
    const state = this.streams.get(streamKey)
    if (!state) return

    const subscribers = state.subscribersBySymbol.get(symbol)
    if (!subscribers || subscribers.size === 0) return

    subscribers.forEach((record) => {
      if (record.channel !== 'quotes') return
      record.socket.emit('market-quote', {
        provider: record.provider,
        market: record.market,
        channel: record.channel,
        subscriptionId: record.subscriptionId,
        listing: record.listing,
        listingBase: record.listingBase,
        listingQuote: record.listingQuote,
        symbol: record.symbol,
        interval: record.interval,
        quote,
        receivedAt: new Date().toISOString(),
        raw,
      })
    })
  }

  private emitQuoteSnapshotToSymbolSubscribers(
    streamState: StreamState,
    symbol: string,
    snapshot: MarketQuoteSnapshot,
    raw?: unknown
  ) {
    const subscribers = streamState.subscribersBySymbol.get(symbol)
    if (!subscribers) return

    subscribers.forEach((record) => {
      if (record.channel !== 'quote-snapshots') return
      this.emitQuoteSnapshot(record, snapshot, raw)
    })
  }

  private emitQuoteSnapshot(
    record: MarketSubscriptionRecord,
    snapshot: MarketQuoteSnapshot,
    raw?: unknown
  ) {
    record.socket.emit('market-quote-snapshot', {
      provider: record.provider,
      market: record.market,
      channel: record.channel,
      subscriptionId: record.subscriptionId,
      clientSubscriptionId: record.clientSubscriptionId,
      listing: record.listing,
      listingBase: record.listingBase,
      listingQuote: record.listingQuote,
      symbol: record.symbol,
      interval: record.interval,
      snapshot,
      receivedAt: new Date().toISOString(),
      raw,
    })
  }

  private ensurePolling(streamState: StreamState) {
    if (streamState.pollingTimer) return
    const intervalMs = streamState.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS
    streamState.pollingTimer = setInterval(() => {
      void this.pollQuoteSnapshots(streamState)
    }, intervalMs)
    streamState.pollingTimer.unref?.()
    void this.pollQuoteSnapshots(streamState)
  }

  private async pollQuoteSnapshots(streamState: StreamState) {
    if (streamState.pollingInFlight) return

    const records = new Map<string, MarketSubscriptionRecord>()
    streamState.subscribersBySymbol.forEach((subscribers, symbol) => {
      const record = Array.from(subscribers.values()).find(
        (subscriber) => subscriber.channel === 'quote-snapshots' && subscriber.listing
      )
      if (record) records.set(symbol, record)
    })

    if (records.size === 0) return

    streamState.pollingInFlight = true
    try {
      const pending = Array.from(records.entries())
      const workers = Array.from(
        { length: Math.min(POLLING_CONCURRENCY, pending.length) },
        async () => {
          while (pending.length > 0) {
            const next = pending.shift()
            if (!next) return
            const [symbol, record] = next
            try {
              const snapshot = await buildMarketQuoteSnapshot({
                provider: record.provider,
                listing: record.listing as ListingIdentity,
                auth: streamState.auth,
                providerParams: streamState.providerParams,
              })
              streamState.quoteSnapshotCache.set(symbol, snapshot)
              this.emitQuoteSnapshotToSymbolSubscribers(streamState, symbol, snapshot)
            } catch (error) {
              const snapshot = createEmptyMarketQuoteSnapshot(
                error instanceof Error ? error.message : 'Failed to poll quote snapshot'
              )
              streamState.quoteSnapshotCache.set(symbol, snapshot)
              this.emitQuoteSnapshotToSymbolSubscribers(streamState, symbol, snapshot)
            }
          }
        }
      )

      await Promise.all(workers)
    } finally {
      streamState.pollingInFlight = false
    }
  }

  private handleStreamError(streamKey: string, message: string, detail?: any) {
    const state = this.streams.get(streamKey)
    if (!state) return

    state.subscribersBySymbol.forEach((subscribers) => {
      subscribers.forEach((record) => {
        record.socket.emit('market-error', {
          provider: record.provider,
          market: record.market,
          channel: record.channel,
          subscriptionId: record.subscriptionId,
          clientSubscriptionId: record.clientSubscriptionId,
          message,
          detail,
        })
      })
    })
  }

  private findMatchingSubscriptions(
    socketMap: Map<string, MarketSubscriptionRecord>,
    payload: MarketUnsubscribePayload
  ): MarketSubscriptionRecord[] {
    if (payload.subscriptionId) {
      const match = socketMap.get(payload.subscriptionId)
      return match ? [match] : []
    }

    if (payload.clientSubscriptionId) {
      const matches: MarketSubscriptionRecord[] = []
      socketMap.forEach((record) => {
        if (record.clientSubscriptionId === payload.clientSubscriptionId) matches.push(record)
      })
      return matches
    }

    const symbol = payload.symbol ? normalizeSymbol(payload.symbol) : undefined
    const provider = payload.provider ? resolveProviderId(payload.provider) : undefined

    const matches: MarketSubscriptionRecord[] = []
    socketMap.forEach((record) => {
      if (provider && record.provider !== provider) return
      if (
        payload.listing &&
        (!record.listing || !areListingIdentitiesEqual(payload.listing, record.listing))
      ) {
        return
      }
      if (symbol && record.symbol !== symbol) return
      matches.push(record)
    })

    return matches
  }

  private removeRecord(record: MarketSubscriptionRecord) {
    const socketMap = this.socketSubscriptions.get(record.socketId)
    if (socketMap) {
      socketMap.delete(record.subscriptionId)
      if (socketMap.size === 0) {
        this.socketSubscriptions.delete(record.socketId)
      }
    }

    const streamState = this.streams.get(record.streamKey)
    if (!streamState) return

    const symbolSubscribers = streamState.subscribersBySymbol.get(record.symbol)
    if (symbolSubscribers) {
      symbolSubscribers.delete(record.subscriptionId)
      if (symbolSubscribers.size === 0) {
        streamState.subscribersBySymbol.delete(record.symbol)
        if (record.upstreamChannel) {
          streamState.stream?.unsubscribe([record.symbol], record.upstreamChannel)
        }
      } else if (record.upstreamChannel) {
        const hasUpstreamChannel = Array.from(symbolSubscribers.values()).some(
          (existing) => existing.upstreamChannel === record.upstreamChannel
        )
        if (!hasUpstreamChannel) {
          streamState.stream?.unsubscribe([record.symbol], record.upstreamChannel)
        }
      }
    }

    if (streamState.subscribersBySymbol.size === 0) {
      if (streamState.pollingTimer) {
        clearInterval(streamState.pollingTimer)
        streamState.pollingTimer = undefined
      }
      streamState.stream?.close()
      this.streams.delete(record.streamKey)
    }

    logger.info('Market subscription removed', {
      socketId: record.socketId,
      userId: record.socket.userId,
      provider: record.provider,
      listing: record.listing,
      symbol: record.symbol,
      market: record.market,
    })
  }
}

export const marketStreamManager = new MarketStreamManager()

function resolveProviderId(provider?: AnyMarketProviderId): AnyMarketProviderId {
  if (provider === 'finnhub') return 'finnhub'
  if (provider === 'yahoo-finance') return 'yahoo-finance'
  if (provider === 'alpha-vantage') return 'alpha-vantage'
  return 'alpaca'
}

function resolveUpstreamChannel(channel: MarketChannel): MarketStreamChannel {
  return channel === 'quote-snapshots' ? 'trades' : channel
}

function resolveMarket(payload: MarketSubscribePayload, assetClass?: string): AlpacaMarket {
  const override = String(
    payload.market ??
      payload.providerParams?.market ??
      payload.providerParams?.alpacaMarket ??
      payload.providerParams?.assetClass ??
      payload.providerParams?.endpoint ??
      ''
  ).toLowerCase()

  if (override === 'crypto') return 'crypto'
  if (override === 'stocks' || override === 'stock' || override === 'equity') return 'stocks'

  return assetClass === 'crypto' ? 'crypto' : 'stocks'
}

function resolveFeed(
  payload: MarketSubscribePayload,
  market: AlpacaMarket
): AlpacaFeed | undefined {
  if (market === 'crypto') return undefined
  const feed = String(payload.feed ?? payload.providerParams?.feed ?? 'iex').toLowerCase()
  return feed === 'sip' ? 'sip' : 'iex'
}

function resolveCryptoRegion(payload: MarketSubscribePayload): AlpacaCryptoRegion {
  const region = String(
    payload.cryptoRegion ??
      payload.providerParams?.cryptoRegion ??
      payload.providerParams?.region ??
      'us'
  ).toLowerCase()
  if (region === 'us-1' || region === 'eu-1') return region
  return 'us'
}

function resolveAlpacaCredentials(payload: MarketSubscribePayload): {
  keyId?: string
  secretKey?: string
} {
  const keyId = payload.auth?.apiKey
  const secretKey = payload.auth?.apiSecret

  return { keyId, secretKey }
}

function resolveFinnhubApiKey(payload: MarketSubscribePayload): string | undefined {
  return payload.auth?.apiKey
}

function buildAlpacaStreamKey(config: {
  provider: MarketProviderId
  workspaceId?: string
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  keyId?: string
  secretKey?: string
}): string {
  const base = [
    config.provider,
    config.workspaceId ?? '',
    config.market,
    config.feed ?? '',
    config.cryptoRegion ?? '',
    config.keyId ?? '',
    config.secretKey ?? '',
  ].join('|')

  return createHash('sha256').update(base).digest('hex')
}

function buildFinnhubStreamKey(config: {
  provider: MarketProviderId
  workspaceId?: string
  apiKey: string
}): string {
  const base = [config.provider, config.workspaceId ?? '', config.apiKey].join('|')
  return createHash('sha256').update(base).digest('hex')
}

function buildPollingStreamKey(config: {
  provider: PollingMarketProviderId
  workspaceId?: string
  auth?: MarketProviderAuth
  providerParams?: MarketProviderParams
}): string {
  const base = [
    config.provider,
    config.workspaceId ?? '',
    stableStringifyJsonValue(config.auth ?? null),
    stableStringifyJsonValue(config.providerParams ?? null),
  ].join('|')
  return createHash('sha256').update(base).digest('hex')
}

function createSubscriptionId({
  streamKey,
  channel,
  symbol,
  interval,
  clientSubscriptionId,
}: {
  streamKey: string
  channel: MarketChannel
  symbol: string
  interval: string
  clientSubscriptionId?: string
}) {
  return [
    streamKey,
    channel,
    symbol,
    interval,
    clientSubscriptionId?.trim() || randomUUID(),
  ].join(':')
}

function resolvePollingIntervalMs(
  provider: PollingMarketProviderId,
  providerParams?: MarketProviderParams
): number {
  const configured = Number(providerParams?.pollingIntervalMs ?? providerParams?.pollIntervalMs)
  const capabilityDefault =
    getMarketLiveCapabilities(provider)?.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS
  const requested =
    Number.isFinite(configured) && configured > 0 ? configured : capabilityDefault
  return Math.max(MIN_POLLING_INTERVAL_MS, requested)
}

function updateSnapshotFromTrade(
  previous: MarketQuoteSnapshot | undefined,
  trade: any
): MarketQuoteSnapshot {
  const price = resolveFiniteNumber(trade?.price)
  if (price === null) return previous ?? createEmptyMarketQuoteSnapshot()

  const previousClose = previous?.previousClose ?? null
  const change =
    previousClose !== null
      ? price - previousClose
      : (previous?.change ?? null)
  const changePercent =
    previousClose !== null && previousClose !== 0
      ? ((price - previousClose) / previousClose) * 100
      : (previous?.changePercent ?? null)
  const volume = previous?.volume ?? null
  const volumeUsd = volume !== null ? volume * price : (previous?.volumeUsd ?? null)

  return {
    lastPrice: price,
    previousClose,
    change,
    changePercent,
    ...(volume !== null ? { volume } : {}),
    ...(volumeUsd !== null ? { volumeUsd } : {}),
    ...(previous?.error ? { error: previous.error } : {}),
  }
}

function resolveFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return ''
  return symbol.trim().toUpperCase()
}

const ENV_VAR_PATTERN = /\{\{([^}]+)\}\}/g

function hasEnvVarRefs(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.includes('{{') && value.includes('}}')
  }
  if (Array.isArray(value)) {
    return value.some((item) => hasEnvVarRefs(item))
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => hasEnvVarRefs(item))
  }
  return false
}

function resolveEnvVarRefs(
  value: unknown,
  envVars: Record<string, string>,
  missing: Set<string>
): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_match, key) => {
      const trimmedKey = String(key).trim()
      if (!trimmedKey) return _match
      const envValue = envVars[trimmedKey]
      if (envValue === undefined) {
        missing.add(trimmedKey)
        return ''
      }
      return envValue
    })
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveEnvVarRefs(item, envVars, missing))
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, val]) => {
      acc[key] = resolveEnvVarRefs(val, envVars, missing)
      return acc
    }, {})
  }

  return value
}

export async function resolveMarketSubscribeEnv(
  payload: MarketSubscribePayload,
  userId?: string
): Promise<MarketSubscribePayload> {
  if (!hasEnvVarRefs(payload.auth) && !hasEnvVarRefs(payload.providerParams)) {
    return payload
  }

  if (!userId) {
    throw new Error('Authentication required to resolve environment variables')
  }

  const envVars = await getEffectiveDecryptedEnv(userId, payload.workspaceId)
  const missingVars = new Set<string>()
  const resolvedAuth = payload.auth
    ? (resolveEnvVarRefs(payload.auth, envVars, missingVars) as MarketSubscribePayload['auth'])
    : payload.auth
  const resolvedProviderParams = payload.providerParams
    ? (resolveEnvVarRefs(
        payload.providerParams,
        envVars,
        missingVars
      ) as MarketSubscribePayload['providerParams'])
    : payload.providerParams

  if (missingVars.size > 0) {
    const missingList = Array.from(missingVars)
    throw new Error(
      `Missing required environment variable${missingList.length > 1 ? 's' : ''}: ${missingList.join(', ')}`
    )
  }

  return {
    ...payload,
    auth: resolvedAuth,
    providerParams: resolvedProviderParams,
  }
}
