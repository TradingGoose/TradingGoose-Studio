import { createHash } from 'crypto'
import { createLogger } from '@/lib/logs/console/logger'
import { resolveListingKey, type ListingIdentity } from '@/lib/listing/identity'
import { alpacaProviderConfig } from '@/providers/market/alpaca/config'
import { finnhubProviderConfig } from '@/providers/market/finnhub/config'
import { resolveListingContext, resolveProviderSymbol } from '@/providers/market/utils'
import type { MarketBar } from '@/providers/market/types'
import type { AuthenticatedSocket } from '@/socket-server/middleware/auth'
import {
  AlpacaMarketStream,
  type AlpacaMarket,
  type AlpacaCryptoRegion,
  type AlpacaFeed,
} from './alpaca'
import { FinnhubMarketStream } from './finnhub'

const logger = createLogger('MarketStreamManager')

export type MarketProviderId = 'alpaca' | 'finnhub'
export type MarketChannel = 'bars' | 'trades' | 'quotes'

export interface MarketSubscribePayload {
  provider?: MarketProviderId
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
  listing?: ListingIdentity
  symbol?: string
  provider?: MarketProviderId
}

export interface MarketSubscriptionInfo {
  subscriptionId: string
  listing: ListingIdentity | null
  symbol: string
  provider: MarketProviderId
  market: AlpacaMarket
  channel: MarketChannel
  interval?: string
}

interface MarketSubscriptionRecord extends MarketSubscriptionInfo {
  streamKey: string
  listingKey: string
  socketId: string
  socket: AuthenticatedSocket
  listingBase?: string
  listingQuote?: string
  primaryMicCode?: string
}

type MarketStream = {
  subscribe: (symbols: string[], channel?: MarketChannel) => void
  unsubscribe: (symbols: string[], channel?: MarketChannel) => void
  close: () => void
}

interface StreamState {
  stream: MarketStream
  provider: MarketProviderId
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  apiKey?: string
  subscribersBySymbol: Map<string, Map<string, MarketSubscriptionRecord>>
}

export class MarketStreamManager {
  private streams = new Map<string, StreamState>()
  private socketSubscriptions = new Map<string, Map<string, MarketSubscriptionRecord>>()

  async subscribe(
    socket: AuthenticatedSocket,
    payload: MarketSubscribePayload
  ): Promise<MarketSubscriptionInfo> {
    const provider = resolveProviderId(payload.provider)

    if (provider === 'alpaca') {
      return this.subscribeAlpaca(socket, payload)
    }

    if (provider === 'finnhub') {
      return this.subscribeFinnhub(socket, payload)
    }

    throw new Error('Unsupported market data provider')
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
    const listingKey = resolveListingKey(listing)
    if (!listing || !listingKey) {
      throw new Error('listing is required to subscribe to market data')
    }

    const channel = payload.channel ?? 'bars'
    if (channel !== 'bars' && channel !== 'trades' && channel !== 'quotes') {
      throw new Error('Unsupported Alpaca channel')
    }

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
    })

    const subscriptionId = `${streamKey}:${channel}:${symbol}`
    const record: MarketSubscriptionRecord = {
      subscriptionId,
      streamKey,
      listingKey,
      listing,
      socketId: socket.id,
      socket,
      symbol,
      provider: 'alpaca',
      market,
      channel,
      interval: payload.interval,
      listingBase: context.base,
      listingQuote: context.quote,
      primaryMicCode: context.primaryMicCode,
    }

    this.addSubscription(streamState, record)

    logger.info('Market subscription added', {
      socketId: socket.id,
      userId: socket.userId,
      provider: 'alpaca',
      listing: listingKey,
      symbol,
      market,
      channel,
    })

    return {
      subscriptionId,
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
    const listingKey = resolveListingKey(listing)
    if (!listing || !listingKey) {
      throw new Error('listing is required to subscribe to market data')
    }

    const channel = payload.channel ?? 'bars'
    if (channel !== 'bars') {
      throw new Error('Finnhub streaming supports bars only')
    }

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

    const streamKey = buildFinnhubStreamKey({ provider: 'finnhub', apiKey })
    const streamState = this.getOrCreateStream(streamKey, {
      provider: 'finnhub',
      market,
      apiKey,
    })

    const subscriptionId = `${streamKey}:${channel}:${symbol}`
    const record: MarketSubscriptionRecord = {
      subscriptionId,
      streamKey,
      listingKey,
      listing,
      socketId: socket.id,
      socket,
      symbol,
      provider: 'finnhub',
      market,
      channel,
      interval: payload.interval,
      listingBase: context.base,
      listingQuote: context.quote,
      primaryMicCode: context.primaryMicCode,
    }

    this.addSubscription(streamState, record)

    logger.info('Market subscription added', {
      socketId: socket.id,
      userId: socket.userId,
      provider: 'finnhub',
      listing: listingKey,
      symbol,
      market,
      channel,
    })

    return {
      subscriptionId,
      listing,
      symbol,
      provider: 'finnhub',
      market,
      channel,
      interval: payload.interval,
    }
  }

  private addSubscription(streamState: StreamState, record: MarketSubscriptionRecord) {
    const symbolSubscribers =
      streamState.subscribersBySymbol.get(record.symbol) ??
      new Map<string, MarketSubscriptionRecord>()

    const hadChannel = Array.from(symbolSubscribers.values()).some(
      (existing) => existing.channel === record.channel
    )

    if (!symbolSubscribers.has(record.subscriptionId)) {
      symbolSubscribers.set(record.subscriptionId, record)
      streamState.subscribersBySymbol.set(record.symbol, symbolSubscribers)

      if (!hadChannel) {
        streamState.stream.subscribe([record.symbol], record.channel)
      }
    }

    const socketMap = this.socketSubscriptions.get(record.socketId) ?? new Map()
    socketMap.set(record.subscriptionId, record)
    this.socketSubscriptions.set(record.socketId, socketMap)
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
            onTrade: ({ symbol, trade, raw }) =>
              this.handleTrade(streamKey, symbol, trade, raw),
            onQuote: ({ symbol, quote, raw }) =>
              this.handleQuote(streamKey, symbol, quote, raw),
            onError: (payload) => this.handleStreamError(streamKey, payload.message, payload.detail),
          }
        )
        : new FinnhubMarketStream(
          {
            apiKey: config.apiKey,
          },
          {
            onBar: ({ symbol, bar, raw }) => this.handleBar(streamKey, symbol, bar, raw),
            onError: (payload) => this.handleStreamError(streamKey, payload.message, payload.detail),
          }
        )

    const state: StreamState = {
      stream,
      provider: config.provider,
      market: config.market,
      feed: config.feed,
      cryptoRegion: config.cryptoRegion,
      apiKey: config.apiKey,
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
        primaryMicCode: record.primaryMicCode,
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

    subscribers.forEach((record) => {
      if (record.channel !== 'trades') return
      record.socket.emit('market-trade', {
        provider: record.provider,
        market: record.market,
        channel: record.channel,
        subscriptionId: record.subscriptionId,
        listing: record.listing,
        listingBase: record.listingBase,
        listingQuote: record.listingQuote,
        primaryMicCode: record.primaryMicCode,
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
        primaryMicCode: record.primaryMicCode,
        symbol: record.symbol,
        interval: record.interval,
        quote,
        receivedAt: new Date().toISOString(),
        raw,
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

    const symbol = payload.symbol ? normalizeSymbol(payload.symbol) : undefined
    const provider = payload.provider ? resolveProviderId(payload.provider) : undefined
    const listingKey = resolveListingKey(payload.listing ?? null)

    const matches: MarketSubscriptionRecord[] = []
    socketMap.forEach((record) => {
      if (provider && record.provider !== provider) return
      if (listingKey && record.listingKey !== listingKey) return
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
        streamState.stream.unsubscribe([record.symbol], record.channel)
      } else {
        const hasChannel = Array.from(symbolSubscribers.values()).some(
          (existing) => existing.channel === record.channel
        )
        if (!hasChannel) {
          streamState.stream.unsubscribe([record.symbol], record.channel)
        }
      }
    }

    if (streamState.subscribersBySymbol.size === 0) {
      streamState.stream.close()
      this.streams.delete(record.streamKey)
    }

    logger.info('Market subscription removed', {
      socketId: record.socketId,
      userId: record.socket.userId,
      provider: record.provider,
      listing: record.listingKey,
      symbol: record.symbol,
      market: record.market,
    })
  }
}

export const marketStreamManager = new MarketStreamManager()

function resolveProviderId(provider?: MarketProviderId): MarketProviderId {
  if (provider === 'finnhub') return 'finnhub'
  return 'alpaca'
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

function resolveFeed(payload: MarketSubscribePayload, market: AlpacaMarket): AlpacaFeed | undefined {
  if (market === 'crypto') return undefined
  const feed = String(payload.feed ?? payload.providerParams?.feed ?? 'iex').toLowerCase()
  return feed === 'sip' ? 'sip' : 'iex'
}

function resolveCryptoRegion(payload: MarketSubscribePayload): AlpacaCryptoRegion {
  const region = String(
    payload.cryptoRegion ?? payload.providerParams?.cryptoRegion ?? payload.providerParams?.region ?? 'us'
  ).toLowerCase()
  if (region === 'us-1' || region === 'eu-1') return region
  return 'us'
}

function resolveAlpacaCredentials(
  payload: MarketSubscribePayload
): { keyId?: string; secretKey?: string } {
  const keyId = payload.auth?.apiKey || process.env.ALPACA_API_KEY_ID
  const secretKey = payload.auth?.apiSecret || process.env.ALPACA_API_SECRET_KEY

  return { keyId, secretKey }
}

function resolveFinnhubApiKey(payload: MarketSubscribePayload): string | undefined {
  return payload.auth?.apiKey || process.env.FINNHUB_API_KEY
}

function buildAlpacaStreamKey(config: {
  provider: MarketProviderId
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
  keyId?: string
  secretKey?: string
}): string {
  const base = [
    config.provider,
    config.market,
    config.feed ?? '',
    config.cryptoRegion ?? '',
    config.keyId ?? '',
    config.secretKey ?? '',
  ].join('|')

  return createHash('sha256').update(base).digest('hex')
}

function buildFinnhubStreamKey(config: { provider: MarketProviderId; apiKey: string }): string {
  const base = [config.provider, config.apiKey].join('|')
  return createHash('sha256').update(base).digest('hex')
}

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return ''
  return symbol.trim().toUpperCase()
}
