import { createLogger } from '@/lib/logs/console/logger'
import type { MarketBar } from '@/providers/market/types'

const logger = createLogger('FinnhubMarketStream')

export interface FinnhubStreamConfig {
  apiKey?: string
}

export interface FinnhubStreamHandlers {
  onBar: (payload: { symbol: string; bar: MarketBar; raw: any }) => void
  onStatus?: (payload: { state: 'connected' | 'disconnected'; info?: string }) => void
  onError?: (payload: { message: string; detail?: any }) => void
}

interface BarState {
  bucketStartMs: number
  bar: MarketBar
}

const ONE_MINUTE_MS = 60 * 1000

export class FinnhubMarketStream {
  private config: FinnhubStreamConfig
  private handlers: FinnhubStreamHandlers
  private socket: WebSocket | null = null
  private desiredSymbols = new Set<string>()
  private activeSymbols = new Set<string>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private closedByClient = false
  private bars = new Map<string, BarState>()

  constructor(config: FinnhubStreamConfig, handlers: FinnhubStreamHandlers) {
    this.config = config
    this.handlers = handlers
  }

  subscribe(symbols: string[], _channel?: string) {
    const next = symbols.map(normalizeSymbol).filter(Boolean)
    if (!next.length) return

    next.forEach((symbol) => this.desiredSymbols.add(symbol))
    this.ensureConnection()

    if (this.socket?.readyState === WebSocket.OPEN) {
      const toSubscribe = next.filter((symbol) => !this.activeSymbols.has(symbol))
      if (toSubscribe.length) {
        toSubscribe.forEach((symbol) => this.sendSubscribe(symbol))
        toSubscribe.forEach((symbol) => this.activeSymbols.add(symbol))
      }
    }
  }

  unsubscribe(symbols: string[], _channel?: string) {
    const next = symbols.map(normalizeSymbol).filter(Boolean)
    if (!next.length) return

    next.forEach((symbol) => this.desiredSymbols.delete(symbol))

    if (this.socket?.readyState === WebSocket.OPEN) {
      const toUnsubscribe = next.filter((symbol) => this.activeSymbols.has(symbol))
      if (toUnsubscribe.length) {
        toUnsubscribe.forEach((symbol) => this.sendUnsubscribe(symbol))
        toUnsubscribe.forEach((symbol) => this.activeSymbols.delete(symbol))
      }
    }

    if (!this.desiredSymbols.size) {
      this.close()
    }
  }

  close() {
    this.closedByClient = true
    this.clearReconnectTimer()
    this.activeSymbols.clear()
    this.bars.clear()

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      try {
        this.socket.close()
      } catch (error) {
        logger.warn('Failed closing Finnhub WebSocket', error)
      }
    }

    this.socket = null
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

    const apiKey = this.config.apiKey
    if (!apiKey) {
      this.handlers.onError?.({ message: 'Missing Finnhub API key for streaming.' })
      return
    }

    if (typeof WebSocket === 'undefined') {
      this.handlers.onError?.({ message: 'WebSocket is not available in this runtime.' })
      return
    }

    const url = `wss://ws.finnhub.io?token=${encodeURIComponent(apiKey)}`

    logger.info('Opening Finnhub stream')
    this.socket = new WebSocket(url)

    this.socket.addEventListener('open', () => {
      this.reconnectAttempts = 0
      this.handlers.onStatus?.({ state: 'connected' })
      this.flushDesiredSubscriptions()
    })

    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data)
    })

    this.socket.addEventListener('error', (event) => {
      this.handlers.onError?.({ message: 'Finnhub stream error', detail: event })
    })

    this.socket.addEventListener('close', () => {
      this.handlers.onStatus?.({ state: 'disconnected' })
      this.activeSymbols.clear()
      this.bars.clear()

      if (!this.closedByClient && this.desiredSymbols.size) {
        this.scheduleReconnect()
      }
    })
  }

  private sendSubscribe(symbol: string) {
    this.sendJson({ type: 'subscribe', symbol })
  }

  private sendUnsubscribe(symbol: string) {
    this.sendJson({ type: 'unsubscribe', symbol })
  }

  private sendJson(payload: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return
    try {
      this.socket.send(JSON.stringify(payload))
    } catch (error) {
      this.handlers.onError?.({ message: 'Failed sending to Finnhub stream', detail: error })
    }
  }

  private handleMessage(raw: any) {
    let payload: any
    try {
      const normalized = normalizeWsPayload(raw)
      payload = typeof normalized === 'string' ? JSON.parse(normalized) : normalized
    } catch (error) {
      this.handlers.onError?.({ message: 'Failed to parse Finnhub stream payload', detail: error })
      return
    }

    const type = payload?.type
    if (type === 'ping') {
      this.sendJson({ type: 'pong' })
      return
    }

    if (type === 'error') {
      this.handlers.onError?.({ message: payload?.msg || 'Finnhub stream error', detail: payload })
      return
    }

    if (type === 'trade' && Array.isArray(payload.data)) {
      payload.data.forEach((trade: any) => this.handleTrade(trade))
    }
  }

  private handleTrade(trade: any) {
    const symbol = normalizeSymbol(trade?.s)
    if (!symbol) return

    const priceValue = toNumber(trade?.p)
    if (priceValue === undefined || !Number.isFinite(priceValue)) return

    const timestampValue = toTimestampMs(trade?.t)
    if (timestampValue === undefined || !Number.isFinite(timestampValue)) return

    const volume = toNumber(trade?.v)

    const bucketStartMs = Math.floor(timestampValue / ONE_MINUTE_MS) * ONE_MINUTE_MS
    const existing = this.bars.get(symbol)

    if (!existing || existing.bucketStartMs !== bucketStartMs) {
      if (existing) {
        // Emit the completed bar when we roll into a new minute bucket.
        this.handlers.onBar({ symbol, bar: existing.bar, raw: trade })
      }

      const bar: MarketBar = {
        timeStamp: new Date(bucketStartMs).toISOString(),
        open: priceValue,
        high: priceValue,
        low: priceValue,
        close: priceValue,
        volume: Number.isFinite(volume) ? volume : undefined,
      }
      this.bars.set(symbol, { bucketStartMs, bar })
      return
    }

    const bar = existing.bar
    bar.close = priceValue
    bar.high = Math.max(bar.high ?? priceValue, priceValue)
    bar.low = Math.min(bar.low ?? priceValue, priceValue)
    if (Number.isFinite(volume)) {
      bar.volume = (bar.volume ?? 0) + volume!
    }
  }

  private flushDesiredSubscriptions() {
    const desired = Array.from(this.desiredSymbols)
    if (!desired.length) return

    this.activeSymbols.clear()
    desired.forEach((symbol) => {
      this.sendSubscribe(symbol)
      this.activeSymbols.add(symbol)
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.closedByClient && this.desiredSymbols.size) {
        this.connect()
      }
    }, delay)
  }

  private clearReconnectTimer() {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}

function normalizeSymbol(symbol?: string): string {
  if (!symbol) return ''
  return symbol.trim().toUpperCase()
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

function toNumber(value: any): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function toTimestampMs(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed > 1e12 ? parsed : parsed * 1000
    }
  }
  return undefined
}
