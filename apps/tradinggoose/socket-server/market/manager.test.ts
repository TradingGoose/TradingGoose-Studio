/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getEffectiveDecryptedEnvMock } = vi.hoisted(() => ({
  getEffectiveDecryptedEnvMock: vi.fn(),
}))

const {
  buildMarketQuoteSnapshotMock,
  executeProviderRequestMock,
  getMarketProviderConfigMock,
  getMarketProviderPollingIntervalMsMock,
  resolveListingContextMock,
  resolveProviderSymbolMock,
  alpacaStreamInstances,
  finnhubStreamInstances,
} = vi.hoisted(() => ({
  buildMarketQuoteSnapshotMock: vi.fn(),
  executeProviderRequestMock: vi.fn(),
  getMarketProviderConfigMock: vi.fn(),
  getMarketProviderPollingIntervalMsMock: vi.fn(),
  resolveListingContextMock: vi.fn(),
  resolveProviderSymbolMock: vi.fn(),
  alpacaStreamInstances: [] as any[],
  finnhubStreamInstances: [] as any[],
}))

vi.mock('@/lib/environment/utils', () => ({
  getEffectiveDecryptedEnv: getEffectiveDecryptedEnvMock,
}))

vi.mock('@/lib/market/quote-snapshots', () => ({
  buildMarketQuoteSnapshot: buildMarketQuoteSnapshotMock,
}))

vi.mock('@/providers/market', () => ({
  executeProviderRequest: executeProviderRequestMock,
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/providers/market/alpaca/config', () => ({
  alpacaProviderConfig: {},
}))

vi.mock('@/providers/market/finnhub/config', () => ({
  finnhubProviderConfig: {},
}))

vi.mock('@/providers/market/providers', () => ({
  getMarketProviderConfig: getMarketProviderConfigMock,
  getMarketProviderPollingIntervalMs: getMarketProviderPollingIntervalMsMock,
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: resolveListingContextMock,
  resolveProviderSymbol: resolveProviderSymbolMock,
}))

vi.mock('@/socket-server/market/alpaca', () => ({
  AlpacaMarketStream: class {
    subscribe = vi.fn()
    unsubscribe = vi.fn()
    close = vi.fn()

    constructor(config: unknown, handlers: unknown) {
      alpacaStreamInstances.push({
        config,
        handlers,
        subscribe: this.subscribe,
        unsubscribe: this.unsubscribe,
        close: this.close,
      })
    }
  },
}))

vi.mock('@/socket-server/market/finnhub', () => ({
  FinnhubMarketStream: class {
    subscribe = vi.fn()
    unsubscribe = vi.fn()
    close = vi.fn()

    constructor(config: unknown, handlers: unknown) {
      finnhubStreamInstances.push({
        config,
        handlers,
        subscribe: this.subscribe,
        unsubscribe: this.unsubscribe,
        close: this.close,
      })
    }
  },
}))

import {
  MarketStreamManager,
  type MarketSubscribePayload,
  resolveMarketSubscribeEnv,
} from './manager'

const listing = {
  listing_id: 'us-aapl',
  base_id: '',
  quote_id: '',
  listing_type: 'default' as const,
}

const quoteSnapshot = {
  lastPrice: 123.45,
  previousClose: 120,
  change: 3.45,
  changePercent: 2.875,
}

const createSocket = (id: string) =>
  ({
    id,
    userId: 'user-1',
    emit: vi.fn(),
  }) as any

describe('resolveMarketSubscribeEnv', () => {
  const originalEnv = process.env.RUNTIME_ONLY_KEY

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.RUNTIME_ONLY_KEY = undefined
  })

  afterEach(() => {
    if (originalEnv === undefined) {
      process.env.RUNTIME_ONLY_KEY = undefined
      return
    }

    process.env.RUNTIME_ONLY_KEY = originalEnv
  })

  it('resolves auth and provider params from user/workspace env placeholders', async () => {
    getEffectiveDecryptedEnvMock.mockResolvedValue({
      ALPACA_API_KEY: 'workspace-key',
      ALPACA_API_SECRET: 'workspace-secret',
      ALPACA_FEED: 'sip',
    })

    const payload: MarketSubscribePayload = {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      auth: {
        apiKey: '{{ ALPACA_API_KEY }}',
        apiSecret: 'token-{{ALPACA_API_SECRET}}',
      },
      providerParams: {
        feed: '{{ ALPACA_FEED }}',
      },
    }

    await expect(resolveMarketSubscribeEnv(payload, 'user-1')).resolves.toEqual({
      ...payload,
      auth: {
        apiKey: 'workspace-key',
        apiSecret: 'token-workspace-secret',
      },
      providerParams: {
        feed: 'sip',
      },
    })

    expect(getEffectiveDecryptedEnvMock).toHaveBeenCalledWith('user-1', 'workspace-1')
  })

  it('does not fall back to deployment env when placeholders are missing', async () => {
    process.env.RUNTIME_ONLY_KEY = 'deployment-secret'
    getEffectiveDecryptedEnvMock.mockResolvedValue({})

    const payload: MarketSubscribePayload = {
      provider: 'finnhub',
      workspaceId: 'workspace-1',
      auth: {
        apiKey: '{{ RUNTIME_ONLY_KEY }}',
      },
    }

    await expect(resolveMarketSubscribeEnv(payload, 'user-1')).rejects.toThrow(
      'Missing required environment variable: RUNTIME_ONLY_KEY'
    )
    expect(getEffectiveDecryptedEnvMock).toHaveBeenCalledWith('user-1', 'workspace-1')
  })
})

describe('MarketStreamManager quote snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    alpacaStreamInstances.length = 0
    finnhubStreamInstances.length = 0
    buildMarketQuoteSnapshotMock.mockResolvedValue(quoteSnapshot)
    executeProviderRequestMock.mockResolvedValue({
      bars: [
        {
          timeStamp: '2026-05-27T14:30:00.000Z',
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1000,
        },
      ],
    })
    getMarketProviderConfigMock.mockReturnValue({})
    getMarketProviderPollingIntervalMsMock.mockImplementation((provider: string) =>
      provider === 'yahoo-finance' ? 5_000 : undefined
    )
    resolveListingContextMock.mockResolvedValue({
      listing,
      base: 'AAPL',
      assetClass: 'stock',
    })
    resolveProviderSymbolMock.mockReturnValue('AAPL')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects subscriptions without an explicit market provider', async () => {
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')

    await expect(
      manager.subscribe(socket, {
        workspaceId: 'workspace-1',
        listing,
        channel: 'quote-snapshots',
        clientSubscriptionId: 'quote-1',
      })
    ).rejects.toThrow('market provider is required')

    expect(alpacaStreamInstances).toHaveLength(0)
    expect(finnhubStreamInstances).toHaveLength(0)
  })

  it('shares one upstream trade subscription for duplicate streaming quote snapshots', async () => {
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')

    const first = await manager.subscribe(socket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-1',
      auth: {
        apiKey: 'alpaca-key',
        apiSecret: 'alpaca-secret',
      },
    })
    const second = await manager.subscribe(socket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-2',
      auth: {
        apiKey: 'alpaca-key',
        apiSecret: 'alpaca-secret',
      },
    })

    expect(first.subscriptionId).not.toBe(second.subscriptionId)
    expect(alpacaStreamInstances).toHaveLength(1)
    expect(alpacaStreamInstances[0].subscribe).toHaveBeenCalledTimes(1)
    expect(alpacaStreamInstances[0].subscribe).toHaveBeenCalledWith(['AAPL'], 'trades')
    expect(buildMarketQuoteSnapshotMock).not.toHaveBeenCalled()

    manager.removeSocket(socket.id)
  })

  it('keeps streaming quote streams separated by workspace', async () => {
    const manager = new MarketStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')

    await manager.subscribe(firstSocket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-1',
      auth: {
        apiKey: 'alpaca-key',
        apiSecret: 'alpaca-secret',
      },
    })
    await manager.subscribe(secondSocket, {
      provider: 'alpaca',
      workspaceId: 'workspace-2',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-2',
      auth: {
        apiKey: 'alpaca-key',
        apiSecret: 'alpaca-secret',
      },
    })

    expect(alpacaStreamInstances).toHaveLength(2)
    expect(alpacaStreamInstances[0].subscribe).toHaveBeenCalledWith(['AAPL'], 'trades')
    expect(alpacaStreamInstances[1].subscribe).toHaveBeenCalledWith(['AAPL'], 'trades')

    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
  })

  it('uses one polling pull for duplicate polling-provider quote snapshots', async () => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')

    await manager.subscribe(firstSocket, {
      provider: 'yahoo-finance',
      workspaceId: 'workspace-1',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-1',
    })
    await manager.subscribe(secondSocket, {
      provider: 'yahoo-finance',
      workspaceId: 'workspace-1',
      listing,
      channel: 'quote-snapshots',
      clientSubscriptionId: 'quote-2',
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(1)
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'market-quote-snapshot',
      expect.objectContaining({
        provider: 'yahoo-finance',
        channel: 'quote-snapshots',
        clientSubscriptionId: 'quote-1',
        snapshot: quoteSnapshot,
      })
    )
    expect(secondSocket.emit).toHaveBeenCalledWith(
      'market-quote-snapshot',
      expect.objectContaining({
        provider: 'yahoo-finance',
        channel: 'quote-snapshots',
        clientSubscriptionId: 'quote-2',
        snapshot: quoteSnapshot,
      })
    )

    buildMarketQuoteSnapshotMock.mockClear()
    vi.advanceTimersByTime(5_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(1)

    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
  })

  it('uses one polling pull for duplicate polling-provider bar streams', async () => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')

    await manager.subscribe(firstSocket, {
      provider: 'yahoo-finance',
      workspaceId: 'workspace-1',
      listing,
      channel: 'bars',
      interval: '1m',
      clientSubscriptionId: 'bars-1',
    })
    await manager.subscribe(secondSocket, {
      provider: 'yahoo-finance',
      workspaceId: 'workspace-1',
      listing,
      channel: 'bars',
      interval: '1m',
      clientSubscriptionId: 'bars-2',
    })

    await Promise.resolve()
    await Promise.resolve()

    expect(executeProviderRequestMock).toHaveBeenCalledTimes(1)
    expect(executeProviderRequestMock).toHaveBeenCalledWith(
      'yahoo-finance',
      expect.objectContaining({
        kind: 'series',
        interval: '1m',
        windows: [{ mode: 'bars', barCount: 1 }],
      })
    )
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'market-bar',
      expect.objectContaining({
        provider: 'yahoo-finance',
        channel: 'bars',
        clientSubscriptionId: 'bars-1',
        bar: expect.objectContaining({ close: 101 }),
      })
    )
    expect(secondSocket.emit).toHaveBeenCalledWith(
      'market-bar',
      expect.objectContaining({
        provider: 'yahoo-finance',
        channel: 'bars',
        clientSubscriptionId: 'bars-2',
        bar: expect.objectContaining({ close: 101 }),
      })
    )

    executeProviderRequestMock.mockClear()
    firstSocket.emit.mockClear()
    secondSocket.emit.mockClear()
    vi.advanceTimersByTime(5_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(executeProviderRequestMock).toHaveBeenCalledTimes(1)
    expect(firstSocket.emit).not.toHaveBeenCalled()
    expect(secondSocket.emit).not.toHaveBeenCalled()

    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
  })
})
