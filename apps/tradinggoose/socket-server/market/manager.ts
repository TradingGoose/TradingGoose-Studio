import { createHash, randomUUID } from 'crypto'
import { resolveOAuthCredentialAccountForUser } from '@/lib/credentials/oauth'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { stableStringifyJsonValue } from '@/lib/json/stable'
import { type ListingIdentity, ListingIdentitySchema } from '@/lib/listing/identity'
import { createLogger } from '@/lib/logs/console/logger'
import {
  createEmptyMarketQuoteSnapshot,
  type MarketQuoteSnapshot,
} from '@/lib/market/quote-snapshot-contract'
import { buildMarketQuoteSnapshot } from '@/lib/market/quote-snapshots'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { executeProviderRequest } from '@/providers/market'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import {
  getMarketProviderConfig,
  getMarketProviderDefinition,
  getMarketProviderPollingIntervalMs,
} from '@/providers/market/providers'
import { intervalToMs } from '@/providers/market/series-planner'
import type {
  MarketBar,
  MarketProviderAuth,
  MarketProviderParams,
  MarketSeries,
  NormalizationMode,
} from '@/providers/market/types'
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
const POLLING_CONCURRENCY = 5
const MAX_RECOVERY_BARS = 2_000

export type MarketProviderId = 'alpaca' | 'finnhub'
export type MarketStreamChannel = 'bars' | 'trades' | 'quotes'
export type MarketChannel = MarketStreamChannel | 'quote-snapshots'

export interface MarketSubscribePayload {
  provider?: string
  clientSubscriptionId?: string
  workspaceId?: string
  listing?: ListingIdentity
  channel?: MarketChannel
  interval?: string
  normalizationMode?: NormalizationMode
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
}

type OAuthConnection = NonNullable<Awaited<ReturnType<typeof resolveOAuthCredentialAccountForUser>>>

export interface MarketSubscriptionInfo {
  subscriptionId: string
  clientSubscriptionId?: string
  listing: ListingIdentity | null
  symbol: string
  provider: string
  market: AlpacaMarket
  channel: MarketChannel
  interval?: string
}

interface MarketSubscriptionRecord extends MarketSubscriptionInfo {
  streamKey: string
  workspaceId?: string
  socketId: string
  socket: AuthenticatedSocket
  upstreamChannel?: MarketStreamChannel
  listingBase?: string
  listingQuote?: string
  oauthConnection?: OAuthConnection
}

type MarketStream = {
  subscribe: (symbols: string[], channel?: MarketStreamChannel) => void
  unsubscribe: (symbols: string[], channel?: MarketStreamChannel) => void
  close: () => void
}

interface StreamState {
  stream?: MarketStream
  provider: string
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  auth?: MarketProviderAuth
  providerParams?: MarketProviderParams
  normalizationMode?: NormalizationMode
  pollingTimer?: ReturnType<typeof setInterval>
  pollingInFlight?: boolean
  quoteSnapshotCache: Map<string, MarketQuoteSnapshot>
  marketBarCache: Map<string, MarketBar>
  subscribersBySymbol: Map<string, Map<string, MarketSubscriptionRecord>>
}

export class MarketSubscriptionCancelledError extends Error {}

export class MarketStreamManager {
  private streams = new Map<string, StreamState>()
  private socketSubscriptions = new Map<string, Map<string, MarketSubscriptionRecord>>()
  private pendingSubscriptions = new Set<{
    socketId: string
    clientSubscriptionId?: string
    cancelled: boolean
  }>()

  async subscribe(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload,
    credentialSource?: 'workspace'
  ): Promise<MarketSubscriptionInfo> {
    const pending = {
      socketId: socket.id,
      clientSubscriptionId: payload.clientSubscriptionId,
      cancelled: false,
    }
    this.pendingSubscriptions.add(pending)
    const assertActive = () => {
      if (pending.cancelled) throw new MarketSubscriptionCancelledError()
    }
    try {
      let resolvedPayload = await resolveMarketSubscribeEnv(payload, socket.userId)
      const provider = resolveProviderId(resolvedPayload.provider)
      const oauth = getMarketProviderDefinition(provider)?.oauth
      let connection: OAuthConnection | undefined
      if (oauth && credentialSource === 'workspace') {
        const credentialId = toNonEmptyString(resolvedPayload.providerParams?.credentialId)
        const workspaceId = toNonEmptyString(resolvedPayload.workspaceId)
        if (!socket.userId || !workspaceId || !credentialId) {
          throw new Error('Select or reconnect your market provider connection')
        }
        const resolvedConnection = await resolveOAuthCredentialAccountForUser({
          credentialId,
          userId: socket.userId,
          workspaceId,
        })
        if (!resolvedConnection || resolvedConnection.providerId !== oauth.provider) {
          throw new Error('Select or reconnect your market provider connection')
        }
        connection = resolvedConnection
        resolvedPayload = {
          ...resolvedPayload,
          providerParams: {
            ...resolvedPayload.providerParams,
            credentialId: connection.accountId,
          },
        }
      }
      if (provider === 'alpaca') {
        return await this.subscribeAlpaca(socket, { ...resolvedPayload, provider }, assertActive)
      }
      if (provider === 'finnhub') {
        return await this.subscribeFinnhub(socket, { ...resolvedPayload, provider }, assertActive)
      }
      return await this.subscribePollingProvider(
        socket,
        { ...resolvedPayload, provider },
        assertActive,
        connection
      )
    } finally {
      this.pendingSubscriptions.delete(pending)
    }
  }

  unsubscribe(
    socket: AuthenticatedSocket,
    payload: MarketUnsubscribePayload
  ): MarketSubscriptionInfo[] {
    if (!payload.subscriptionId) {
      this.cancelPendingSubscriptions(socket.id, payload.clientSubscriptionId)
    }
    const socketMap = this.socketSubscriptions.get(socket.id)
    if (!socketMap || socketMap.size === 0) return []

    const matches = this.findMatchingSubscriptions(socketMap, payload)
    if (!matches.length) return []

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
    this.cancelPendingSubscriptions(socketId)
    const socketMap = this.socketSubscriptions.get(socketId)
    if (!socketMap) return

    socketMap.forEach((record) => this.removeRecord(record))
  }

  private cancelPendingSubscriptions(socketId: string, clientSubscriptionId?: string) {
    for (const pending of this.pendingSubscriptions) {
      if (
        pending.socketId === socketId &&
        (!clientSubscriptionId || pending.clientSubscriptionId === clientSubscriptionId)
      ) {
        pending.cancelled = true
      }
    }
  }

  private async subscribeAlpaca(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload,
    assertActive: () => void
  ): Promise<MarketSubscriptionInfo> {
    const listing = ListingIdentitySchema.parse(payload.listing)

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
    assertActive()
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
    payload: MarketSubscribePayload,
    assertActive: () => void
  ): Promise<MarketSubscriptionInfo> {
    const listing = ListingIdentitySchema.parse(payload.listing)

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
    assertActive()
    const streamState = this.getOrCreateStream(streamKey, {
      provider: 'finnhub',
      market,
      apiKey,
      auth: { apiKey },
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
    payload: MarketSubscribePayload & { provider: string },
    assertActive: () => void,
    connection?: OAuthConnection
  ): Promise<MarketSubscriptionInfo> {
    const listing = ListingIdentitySchema.parse(payload.listing)

    const channel = payload.channel ?? 'quote-snapshots'
    if (channel !== 'quote-snapshots' && channel !== 'bars') {
      throw new Error('Polling market providers support bars and quote snapshots only')
    }

    if (channel === 'bars' && !payload.interval?.trim()) {
      throw new Error('interval is required to poll market bars')
    }

    const providerConfig = getMarketProviderConfig(payload.provider)
    if (!providerConfig) {
      throw new Error(`Market provider not found: ${payload.provider}`)
    }

    const oauth = getMarketProviderDefinition(payload.provider)?.oauth
    const connectionOwnerUserId = connection?.credentialOwnerUserId ?? socket.userId
    if (oauth) {
      if (!connection && connectionOwnerUserId && payload.workspaceId) {
        const access = await checkWorkspaceAccess(payload.workspaceId, connectionOwnerUserId)
        if (!access.exists || !access.hasAccess) {
          throw new Error('Market connection owner no longer has workspace access')
        }
      }
      const { refreshAccessTokenIfNeeded } = await import('@/lib/oauth/tokens')
      const credentialId = payload.providerParams?.credentialId
      const hasConnection = typeof credentialId === 'string' && credentialId.trim().length > 0
      const accessToken =
        connectionOwnerUserId && hasConnection
          ? await refreshAccessTokenIfNeeded(
              credentialId.trim(),
              connectionOwnerUserId,
              randomUUID(),
              oauth.provider
            )
          : null
      if (!accessToken) {
        throw new Error('Select or reconnect your market provider connection')
      }
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
      userId: oauth ? socket.userId : undefined,
      auth: payload.auth,
      providerParams: payload.providerParams,
      normalizationMode: payload.normalizationMode,
      workspaceCredentialId: connection?.credentialId,
    })
    assertActive()
    const streamState = this.getOrCreatePollingStream(streamKey, {
      provider: payload.provider,
      auth: payload.auth,
      providerParams: payload.providerParams,
      normalizationMode: payload.normalizationMode,
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
      workspaceId: payload.workspaceId,
      listingBase: context.base,
      listingQuote: context.quote,
      oauthConnection: connection,
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

    if (record.channel === 'bars' && record.interval) {
      const cached = streamState.marketBarCache.get(
        buildPollingBarCacheKey(record.symbol, record.interval)
      )
      if (cached) {
        this.emitMarketBar(record, cached)
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
      marketBarCache: new Map(),
      subscribersBySymbol: new Map(),
    }

    this.streams.set(streamKey, state)
    return state
  }

  private getOrCreatePollingStream(
    streamKey: string,
    config: {
      provider: string
      auth?: MarketProviderAuth
      providerParams?: MarketProviderParams
      normalizationMode?: NormalizationMode
    }
  ): StreamState {
    const existing = this.streams.get(streamKey)
    if (existing) return existing

    const state: StreamState = {
      provider: config.provider,
      market: 'stocks',
      auth: config.auth,
      providerParams: config.providerParams,
      normalizationMode: config.normalizationMode,
      quoteSnapshotCache: new Map(),
      marketBarCache: new Map(),
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
      this.emitMarketBar(record, bar, raw)
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
        clientSubscriptionId: record.clientSubscriptionId,
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

  private emitMarketBar(record: MarketSubscriptionRecord, bar: MarketBar, raw?: unknown) {
    record.socket.emit('market-bar', {
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
      bar,
      receivedAt: new Date().toISOString(),
      raw,
    })
  }

  private emitMarketBarToSymbolSubscribers(
    streamState: StreamState,
    symbol: string,
    interval: string,
    bar: MarketBar,
    raw?: unknown
  ) {
    const subscribers = streamState.subscribersBySymbol.get(symbol)
    if (!subscribers) return

    subscribers.forEach((record) => {
      if (record.channel !== 'bars' || record.interval !== interval) return
      this.emitMarketBar(record, bar, raw)
    })
  }

  private ensurePolling(streamState: StreamState) {
    if (streamState.pollingTimer) return
    const intervalMs =
      getMarketProviderPollingIntervalMs(streamState.provider) ?? DEFAULT_POLLING_INTERVAL_MS
    streamState.pollingTimer = setInterval(() => {
      void this.pollMarketData(streamState)
    }, intervalMs)
    streamState.pollingTimer.unref?.()
    void this.pollMarketData(streamState)
  }

  private async pollMarketData(streamState: StreamState) {
    if (streamState.pollingInFlight) return

    const tasks: Array<{
      type: 'quote-snapshot' | 'bar'
      symbol: string
      interval?: string
      record: MarketSubscriptionRecord
    }> = []
    streamState.subscribersBySymbol.forEach((subscribers, symbol) => {
      const quoteRecord = Array.from(subscribers.values()).find(
        (subscriber) => subscriber.channel === 'quote-snapshots' && subscriber.listing
      )

      if (quoteRecord) {
        tasks.push({ type: 'quote-snapshot', symbol, record: quoteRecord })
      }

      const barRecordsByInterval = new Map<string, MarketSubscriptionRecord>()
      subscribers.forEach((subscriber) => {
        if (subscriber.channel !== 'bars' || !subscriber.listing || !subscriber.interval) return
        if (!barRecordsByInterval.has(subscriber.interval)) {
          barRecordsByInterval.set(subscriber.interval, subscriber)
        }
      })
      barRecordsByInterval.forEach((record, interval) => {
        tasks.push({ type: 'bar', symbol, interval, record })
      })
    })

    if (tasks.length === 0) return

    streamState.pollingInFlight = true
    try {
      let workspaceAccess: Promise<boolean> | undefined
      const pending = [...tasks]
      const workers = Array.from(
        { length: Math.min(POLLING_CONCURRENCY, pending.length) },
        async () => {
          while (pending.length > 0) {
            const next = pending.shift()
            if (!next) return
            try {
              const record = next.record
              if (record.workspaceId && getMarketProviderDefinition(record.provider)?.oauth) {
                const hasAccess = await (workspaceAccess ??= canUseOAuthMarketConnection(record))
                if (
                  streamState.subscribersBySymbol.get(next.symbol)?.get(record.subscriptionId) !==
                  record
                ) {
                  continue
                }
                if (!hasAccess) {
                  this.handleStreamError(record.streamKey, 'Market connection access was revoked')
                  streamState.subscribersBySymbol.forEach((subscribers) => {
                    subscribers.forEach((subscriber) => this.removeRecord(subscriber))
                  })
                  return
                }
              }
              if (next.type === 'quote-snapshot') {
                const snapshot = await buildMarketQuoteSnapshot({
                  provider: next.record.provider,
                  listing: next.record.listing as ListingIdentity,
                  auth: streamState.auth,
                  providerParams: streamState.providerParams,
                  context: {
                    userId:
                      next.record.oauthConnection?.credentialOwnerUserId ??
                      next.record.socket.userId,
                  },
                })
                streamState.quoteSnapshotCache.set(next.symbol, snapshot)
                this.emitQuoteSnapshotToSymbolSubscribers(streamState, next.symbol, snapshot)
                continue
              }

              await this.pollMarketBar(streamState, next.symbol, next.interval!, next.record)
            } catch (error) {
              if (next.type === 'quote-snapshot') {
                const snapshot = createEmptyMarketQuoteSnapshot(
                  error instanceof Error ? error.message : 'Failed to poll quote snapshot'
                )
                streamState.quoteSnapshotCache.set(next.symbol, snapshot)
                this.emitQuoteSnapshotToSymbolSubscribers(streamState, next.symbol, snapshot)
                continue
              }

              this.emitMarketPollingError(
                streamState,
                next.symbol,
                next.interval!,
                error instanceof Error ? error.message : 'Failed to poll market bar'
              )
            }
          }
        }
      )

      await Promise.all(workers)
    } finally {
      streamState.pollingInFlight = false
    }
  }

  private async pollMarketBar(
    streamState: StreamState,
    symbol: string,
    interval: string,
    record: MarketSubscriptionRecord
  ) {
    const cacheKey = buildPollingBarCacheKey(symbol, interval)
    let cached = streamState.marketBarCache.get(cacheKey)
    const now = Date.now()
    const cachedTime = cached ? Date.parse(cached.timeStamp) : Number.NaN
    if (!Number.isFinite(cachedTime) || cachedTime > now) cached = undefined
    const intervalMs = intervalToMs(interval)
    const recoveryStart =
      cached && intervalMs
        ? new Date(Math.max(cachedTime, now - MAX_RECOVERY_BARS * intervalMs)).toISOString()
        : null
    const response = await executeProviderRequest(
      record.provider,
      {
        kind: 'series',
        listing: record.listing as ListingIdentity,
        interval,
        normalizationMode: streamState.normalizationMode,
        auth: streamState.auth,
        providerParams: {
          ...(streamState.providerParams ?? {}),
          allowEmpty: true,
        },
        // Include the last candle to finalize it and recover recent missed intervals.
        windows: recoveryStart
          ? [{ mode: 'absolute', start: recoveryStart, end: new Date(now).toISOString() }]
          : [{ mode: 'bars', barCount: 1 }],
      },
      { userId: record.oauthConnection?.credentialOwnerUserId ?? record.socket.userId }
    )
    for (const bar of (response as MarketSeries).bars) {
      if (
        cached &&
        (Date.parse(bar.timeStamp) < Date.parse(cached.timeStamp) ||
          areMarketBarsEqual(cached, bar))
      )
        continue
      cached = bar
      streamState.marketBarCache.set(cacheKey, bar)
      this.emitMarketBarToSymbolSubscribers(streamState, symbol, interval, bar)
    }
  }

  private emitMarketPollingError(
    streamState: StreamState,
    symbol: string,
    interval: string,
    message: string
  ) {
    const subscribers = streamState.subscribersBySymbol.get(symbol)
    if (!subscribers) return

    subscribers.forEach((record) => {
      if (record.channel !== 'bars' || record.interval !== interval) return
      record.socket.emit('market-error', {
        provider: record.provider,
        market: record.market,
        channel: record.channel,
        subscriptionId: record.subscriptionId,
        clientSubscriptionId: record.clientSubscriptionId,
        message,
      })
    })
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

    return [...socketMap.values()].filter(
      (record) =>
        !payload.clientSubscriptionId ||
        record.clientSubscriptionId === payload.clientSubscriptionId
    )
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

function resolveProviderId(provider?: string): string {
  const providerId = typeof provider === 'string' ? provider.trim() : ''
  if (providerId && getMarketProviderConfig(providerId)) return providerId
  throw new Error('market provider is required')
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
  provider: string
  workspaceId?: string
  userId?: string
  auth?: MarketProviderAuth
  providerParams?: MarketProviderParams
  normalizationMode?: NormalizationMode
  workspaceCredentialId?: string
}): string {
  const base = [
    config.provider,
    config.workspaceId ?? '',
    config.userId ?? '',
    stableStringifyJsonValue(config.auth ?? null),
    stableStringifyJsonValue(config.providerParams ?? null),
    config.normalizationMode ?? '',
    config.workspaceCredentialId ?? '',
  ].join('|')
  return createHash('sha256').update(base).digest('hex')
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function canUseOAuthMarketConnection(record: MarketSubscriptionRecord) {
  const ownerUserId = record.oauthConnection?.credentialOwnerUserId ?? record.socket.userId
  if (!record.workspaceId || !ownerUserId) return false
  if (!record.oauthConnection) {
    const access = await checkWorkspaceAccess(record.workspaceId, ownerUserId)
    return access.exists && access.hasAccess
  }
  if (!record.socket.userId) return false
  const resolved = await resolveOAuthCredentialAccountForUser({
    credentialId: record.oauthConnection.credentialId,
    userId: record.socket.userId,
    workspaceId: record.workspaceId,
  })
  return Boolean(
    resolved &&
      resolved.accountId === record.oauthConnection.accountId &&
      resolved.credentialOwnerUserId === ownerUserId &&
      resolved.providerId === getMarketProviderDefinition(record.provider)?.oauth?.provider
  )
}

function buildPollingBarCacheKey(symbol: string, interval: string): string {
  return `${symbol}|${interval}`
}

function areMarketBarsEqual(left: MarketBar, right: MarketBar): boolean {
  return (
    left.timeStamp === right.timeStamp &&
    left.open === right.open &&
    left.high === right.high &&
    left.low === right.low &&
    left.close === right.close &&
    left.volume === right.volume &&
    left.turnover === right.turnover
  )
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
  return [streamKey, channel, symbol, interval, clientSubscriptionId?.trim() || randomUUID()].join(
    ':'
  )
}

function updateSnapshotFromTrade(
  previous: MarketQuoteSnapshot | undefined,
  trade: any
): MarketQuoteSnapshot {
  const price = resolveFiniteNumber(trade?.price)
  if (price === null) return previous ?? createEmptyMarketQuoteSnapshot()

  const previousClose = previous?.previousClose ?? null
  const change = previousClose !== null ? price - previousClose : (previous?.change ?? null)
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
