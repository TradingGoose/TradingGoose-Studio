import { createLogger } from '@/lib/logs/console/logger'
import type { MarketBar } from '@/providers/market/types'

const logger = createLogger('AlpacaMarketStream')

export type AlpacaMarket = 'stocks' | 'crypto'
export type AlpacaChannel = 'bars' | 'trades' | 'quotes'
export type AlpacaFeed = 'iex' | 'sip'
export type AlpacaCryptoRegion = 'us' | 'us-1' | 'eu-1'

export interface AlpacaStreamConfig {
  keyId?: string
  secretKey?: string
  market: AlpacaMarket
  feed?: AlpacaFeed
  cryptoRegion?: AlpacaCryptoRegion
}

export interface AlpacaStreamHandlers {
  onBar: (payload: { symbol: string; bar: MarketBar; raw: any }) => void
  onTrade?: (payload: { symbol: string; trade: AlpacaTrade; raw: any }) => void
  onQuote?: (payload: { symbol: string; quote: AlpacaQuote; raw: any }) => void
  onStatus?: (payload: { state: 'connected' | 'authenticated' | 'disconnected'; info?: string }) => void
  onError?: (payload: { message: string; detail?: any }) => void
}

export interface AlpacaTrade {
  timeStamp: string
  price: number
  size?: number
  exchange?: string
  conditions?: string[]
  id?: string
}

export interface AlpacaQuote {
  timeStamp: string
  bidPrice?: number
  askPrice?: number
  bidSize?: number
  askSize?: number
  exchange?: string
  conditions?: string[]
}

export class AlpacaMarketStream {
  private config: AlpacaStreamConfig
  private handlers: AlpacaStreamHandlers
  private socket: WebSocket | null = null
  private authenticated = false
  private desiredSymbols = new Map<AlpacaChannel, Set<string>>()
  private activeSymbols = new Map<AlpacaChannel, Set<string>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closedByClient = false

  constructor(config: AlpacaStreamConfig, handlers: AlpacaStreamHandlers) {
    this.config = config
    this.handlers = handlers
  }

  subscribe(symbols: string[], channel: AlpacaChannel = 'bars') {
    const next = symbols.map(normalizeSymbol).filter(Boolean)
    if (!next.length) return

    const desired = this.getSymbolSet(this.desiredSymbols, channel)
    next.forEach((symbol) => desired.add(symbol))
    this.ensureConnection()

    if (this.authenticated) {
      const active = this.getSymbolSet(this.activeSymbols, channel)
      const toSubscribe = next.filter((symbol) => !active.has(symbol))
      if (toSubscribe.length) {
        this.sendSubscribe(channel, toSubscribe)
        toSubscribe.forEach((symbol) => active.add(symbol))
      }
    }
  }

  unsubscribe(symbols: string[], channel: AlpacaChannel = 'bars') {
    const next = symbols.map(normalizeSymbol).filter(Boolean)
    if (!next.length) return

    const desired = this.getSymbolSet(this.desiredSymbols, channel)
    next.forEach((symbol) => desired.delete(symbol))

    if (this.authenticated) {
      const active = this.getSymbolSet(this.activeSymbols, channel)
      const toUnsubscribe = next.filter((symbol) => active.has(symbol))
      if (toUnsubscribe.length) {
        this.sendUnsubscribe(channel, toUnsubscribe)
        toUnsubscribe.forEach((symbol) => active.delete(symbol))
      }
    }

    if (!this.hasDesiredSymbols()) {
      this.close()
    }
  }

  close() {
    this.closedByClient = true
    this.clearReconnectTimer()
    this.authenticated = false
    this.activeSymbols.clear()
    this.desiredSymbols.clear()

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        this.socket.close()
      } catch (error) {
        logger.warn('Failed closing Alpaca WebSocket', error)
      }
    }

    this.socket = null
  }

  getDesiredSymbols(): string[] {
    const symbols = new Set<string>()
    for (const set of this.desiredSymbols.values()) {
      set.forEach((symbol) => symbols.add(symbol))
    }
    return Array.from(symbols)
  }

  private ensureConnection() {
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return
    }

    this.connect()
  }

  private connect() {
    this.clearReconnectTimer()
    this.closedByClient = false

    const url = buildAlpacaStreamUrl(this.config)
    if (!url) {
      this.handlers.onError?.({ message: 'Missing Alpaca stream URL configuration.' })
      return
    }

    if (typeof WebSocket === 'undefined') {
      this.handlers.onError?.({ message: 'WebSocket is not available in this runtime.' })
      return
    }

    logger.info('Opening Alpaca stream', {
      market: this.config.market,
      feed: this.config.feed,
      cryptoRegion: this.config.cryptoRegion,
    })

    this.socket = new WebSocket(url)

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0
      this.handlers.onStatus?.({ state: 'connected' })
      this.authenticate()
    })

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })

    this.socket.addEventListener('error', (event) => {
      this.handlers.onError?.({ message: 'Alpaca stream error', detail: event })
    })

    this.socket.addEventListener('close', () => {
      this.handlers.onStatus?.({ state: 'disconnected' })
      this.authenticated = false
      this.activeSymbols.clear()

      if (!this.closedByClient && this.hasDesiredSymbols()) {
        this.scheduleReconnect()
      }
    })
  }

  private authenticate() {
    const { keyId, secretKey } = this.config
    if (!keyId || !secretKey) {
      this.handlers.onError?.({ message: 'Missing Alpaca API key or secret for streaming.' })
      return
    }

    this.sendJson({ action: 'auth', key: keyId, secret: secretKey })
  }

  private sendSubscribe(channel: AlpacaChannel, symbols: string[]) {
    if (!symbols.length) return
    this.sendJson({ action: 'subscribe', [channel]: symbols })
  }

  private sendUnsubscribe(channel: AlpacaChannel, symbols: string[]) {
    if (!symbols.length) return
    this.sendJson({ action: 'unsubscribe', [channel]: symbols })
  }

  private sendJson(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try {
      this.socket.send(JSON.stringify(payload))
    } catch (error) {
      this.handlers.onError?.({ message: 'Failed sending to Alpaca stream', detail: error })
    }
  }

  private handleMessage(raw: any) {
    let payload: any
    try {
      const normalized = normalizeWsPayload(raw)
      payload = typeof normalized === 'string' ? JSON.parse(normalized) : normalized
    } catch (error) {
      this.handlers.onError?.({ message: 'Failed to parse Alpaca stream payload', detail: error })
      return
    }

    const messages = Array.isArray(payload) ? payload : [payload]
    messages.forEach((message) => this.handleEnvelope(message))
  }

  private handleEnvelope(message: any) {
    const type = message?.T
    if (type === 'success') {
      const msg = String(message?.msg || '').toLowerCase()
      if (msg.includes('authenticated')) {
        this.authenticated = true
        this.handlers.onStatus?.({ state: 'authenticated' })
        this.flushDesiredSubscriptions()
      }
      return
    }

    if (type === 'error') {
      this.handlers.onError?.({ message: message?.msg || 'Alpaca stream error', detail: message })
      return
    }

    if (type === 'subscription') {
      return
    }

    if (type === 'b' || type === 'bar') {
      const symbol = normalizeSymbol(message?.S || message?.symbol)
      const bar = toMarketBar(message)
      if (symbol && bar) {
        this.handlers.onBar({ symbol, bar, raw: message })
      }
      return
    }

    if (type === 't' || type === 'trade') {
      const symbol = normalizeSymbol(message?.S || message?.symbol)
      const trade = toTrade(message)
      if (symbol && trade) {
        this.handlers.onTrade?.({ symbol, trade, raw: message })
      }
      return
    }

    if (type === 'q' || type === 'quote') {
      const symbol = normalizeSymbol(message?.S || message?.symbol)
      const quote = toQuote(message)
      if (symbol && quote) {
        this.handlers.onQuote?.({ symbol, quote, raw: message })
      }
      return
    }
  }

  private flushDesiredSubscriptions() {
    if (!this.authenticated) return

    this.activeSymbols.clear()
    for (const [channel, symbols] of this.desiredSymbols.entries()) {
      const desired = Array.from(symbols)
      if (!desired.length) continue
      this.sendSubscribe(channel, desired)
      const active = this.getSymbolSet(this.activeSymbols, channel)
      desired.forEach((symbol) => active.add(symbol))
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByClient && this.hasDesiredSymbols()) {
        this.connect()
      }
    }, delay)
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private getSymbolSet(
    map: Map<AlpacaChannel, Set<string>>,
    channel: AlpacaChannel
  ): Set<string> {
    let set = map.get(channel)
    if (!set) {
      set = new Set<string>()
      map.set(channel, set)
    }
    return set
  }

  private hasDesiredSymbols(): boolean {
    for (const symbols of this.desiredSymbols.values()) {
      if (symbols.size) return true
    }
    return false
  }
}

function buildAlpacaStreamUrl(config: AlpacaStreamConfig): string | null {
  if (config.market === 'crypto') {
    const region = config.cryptoRegion || 'us'
    return `wss://stream.data.alpaca.markets/v1beta3/crypto/${region}`
  }

  const feed = config.feed || 'iex'
  return `wss://stream.data.alpaca.markets/v2/${feed}`
}

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return ''
  return symbol.trim().toUpperCase()
}

function toMarketBar(message: any): MarketBar | null {
  const closeValue = toNumber(message?.c ?? message?.close)
  if (closeValue === undefined || !Number.isFinite(closeValue)) return null

  const timeValue = message?.t ?? message?.timestamp
  const timeStamp = toIsoString(timeValue)
  if (!timeStamp) return null

  const open = toNumber(message?.o ?? message?.open)
  const high = toNumber(message?.h ?? message?.high)
  const low = toNumber(message?.l ?? message?.low)
  const volume = toNumber(message?.v ?? message?.volume)

  return {
    timeStamp,
    close: closeValue,
    open: Number.isFinite(open) ? open : undefined,
    high: Number.isFinite(high) ? high : undefined,
    low: Number.isFinite(low) ? low : undefined,
    volume: Number.isFinite(volume) ? volume : undefined,
  }
}

function toNumber(value: any): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toTrade(message: any): AlpacaTrade | null {
  const priceValue = toNumber(message?.p ?? message?.price)
  if (priceValue === undefined || !Number.isFinite(priceValue)) return null

  const timeStamp = toIsoString(message?.t ?? message?.timestamp)
  if (!timeStamp) return null

  const sizeValue = toNumber(message?.s ?? message?.size)
  const exchange = message?.x ?? message?.exchange
  const conditions = normalizeConditions(message?.c ?? message?.conditions)
  const id = message?.i ?? message?.id

  return {
    timeStamp,
    price: priceValue,
    size: Number.isFinite(sizeValue) ? sizeValue : undefined,
    exchange: exchange ? String(exchange) : undefined,
    conditions,
    id: id ? String(id) : undefined,
  }
}

function toQuote(message: any): AlpacaQuote | null {
  const bidPrice = toNumber(message?.bp ?? message?.bid_price ?? message?.bidPrice)
  const askPrice = toNumber(message?.ap ?? message?.ask_price ?? message?.askPrice)

  if (!Number.isFinite(bidPrice) && !Number.isFinite(askPrice)) return null

  const timeStamp = toIsoString(message?.t ?? message?.timestamp)
  if (!timeStamp) return null

  const bidSize = toNumber(message?.bs ?? message?.bid_size ?? message?.bidSize)
  const askSize = toNumber(message?.as ?? message?.ask_size ?? message?.askSize)
  const exchange = message?.x ?? message?.exchange
  const conditions = normalizeConditions(message?.c ?? message?.conditions)

  return {
    timeStamp,
    bidPrice: Number.isFinite(bidPrice) ? bidPrice : undefined,
    askPrice: Number.isFinite(askPrice) ? askPrice : undefined,
    bidSize: Number.isFinite(bidSize) ? bidSize : undefined,
    askSize: Number.isFinite(askSize) ? askSize : undefined,
    exchange: exchange ? String(exchange) : undefined,
    conditions,
  }
}

function toIsoString(value: any): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value > 1e12 ? value : value * 1000)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

function normalizeWsPayload(raw: any): string | any {
  if (typeof raw === 'string') return raw
  if (raw instanceof ArrayBuffer) {
    return new TextDecoder().decode(raw)
  }
  if (ArrayBuffer.isView(raw)) {
    return new TextDecoder().decode(raw)
  }
  return raw
}

function normalizeConditions(value: any): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => String(entry)).filter(Boolean)
    return normalized.length ? normalized : undefined
  }
  if (value === undefined || value === null) return undefined
  const text = String(value)
  return text ? [text] : undefined
}
