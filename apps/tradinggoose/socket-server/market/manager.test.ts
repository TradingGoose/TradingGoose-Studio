/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getEffectiveDecryptedEnvMock, checkWorkspaceAccessMock } = vi.hoisted(() => ({
  getEffectiveDecryptedEnvMock: vi.fn(),
  checkWorkspaceAccessMock: vi.fn(),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
}))

const { refreshAccessTokenIfNeededMock } = vi.hoisted(() => ({
  refreshAccessTokenIfNeededMock: vi.fn(),
}))
vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: refreshAccessTokenIfNeededMock,
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
  getMarketProviderDefinition: (id: string) =>
    id === 'robinhood' ? { oauth: { provider: 'robinhood' } } : undefined,
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

  it.each(['bars', 'trades'] as const)(
    'identifies each streaming %s subscriber',
    async (channel) => {
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      await manager.subscribe(socket, {
        provider: 'alpaca',
        listing,
        channel,
        clientSubscriptionId: 'chart-1',
        auth: { apiKey: 'key', apiSecret: 'secret' },
      })
      const event = channel === 'bars' ? 'bar' : 'trade'
      const handler = channel === 'bars' ? 'onBar' : 'onTrade'
      alpacaStreamInstances[0].handlers[handler]({ symbol: 'AAPL', [event]: { close: 101 } })
      expect(socket.emit).toHaveBeenCalledWith(
        `market-${event}`,
        expect.objectContaining({ clientSubscriptionId: 'chart-1' })
      )
      manager.removeSocket(socket.id)
    }
  )

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
      }),
      { userId: 'user-1' }
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

  it('corrects the previous candle and resumes missed bars after empty or failed polls', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-22T14:00:30Z'))
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')
    const partial = {
      timeStamp: '2026-09-22T14:00:00.000Z',
      open: 100,
      high: 101,
      low: 99,
      close: 101,
      volume: 10,
    }
    const finalized = { ...partial, high: 110, close: 110, volume: 20 }
    const next = { ...partial, timeStamp: '2026-09-22T14:01:00.000Z' }
    refreshAccessTokenIfNeededMock.mockResolvedValue('token')
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    executeProviderRequestMock.mockResolvedValue({ bars: [partial] })
    await manager.subscribe(socket, {
      provider: 'robinhood',
      workspaceId: 'workspace-1',
      listing,
      channel: 'bars',
      interval: '1m',
      clientSubscriptionId: 'chart',
      providerParams: { credentialId: 'connection' },
    })
    await vi.advanceTimersByTimeAsync(0)

    executeProviderRequestMock.mockResolvedValue({ bars: [finalized, next] })
    vi.setSystemTime(new Date('2026-09-22T14:01:00Z'))
    await vi.advanceTimersByTimeAsync(15_000)
    const emittedBars = () =>
      socket.emit.mock.calls
        .filter(([event]: [string]) => event === 'market-bar')
        .map(([, payload]: [string, any]) => payload.bar)
    expect(emittedBars()).toEqual([partial, finalized, next])
    expect(executeProviderRequestMock.mock.lastCall?.[1].windows).toEqual([
      { mode: 'absolute', start: partial.timeStamp, end: new Date().toISOString() },
    ])

    const missed = [2, 3].map((minute) => ({
      ...finalized,
      timeStamp: `2026-09-22T14:0${minute}:00.000Z`,
    }))
    executeProviderRequestMock
      .mockResolvedValueOnce({ bars: [] })
      .mockRejectedValueOnce(new Error('Temporary provider failure'))
      .mockResolvedValue({ bars: [next, ...missed] })
    vi.setSystemTime(new Date('2026-09-22T14:03:00Z'))
    await vi.advanceTimersByTimeAsync(45_000)
    expect(emittedBars()).toEqual([partial, finalized, next, ...missed])
    for (const [, request] of executeProviderRequestMock.mock.calls.slice(-3)) {
      expect(request.windows).toEqual([
        { mode: 'absolute', start: next.timeStamp, end: expect.any(String) },
      ])
    }

    executeProviderRequestMock
      .mockResolvedValueOnce({ bars: [partial] })
      .mockResolvedValue({ bars: [missed[1]] })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(emittedBars()).toEqual([partial, finalized, next, ...missed])
    expect(executeProviderRequestMock.mock.lastCall?.[1].windows).toEqual([
      { mode: 'absolute', start: missed[1].timeStamp, end: new Date().toISOString() },
    ])
    manager.removeSocket(socket.id)
  })

  it.each([
    ['1m', 1999 * 60_000, 'absolute'],
    ['1m', 2000 * 60_000, 'bars'],
    ['1d', 2000 * 60_000, 'absolute'],
    ['1m', -60_000, 'bars'],
    ['1m', Number.NaN, 'bars'],
    ['invalid', 60_000, 'bars'],
  ] as const)('bounds recovery for %s with cached age %s', async (interval, ageMs, mode) => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T14:30:00Z'))
    const manager = new MarketStreamManager()
    const socket = createSocket('recovery')
    const timeStamp = Number.isFinite(ageMs)
      ? new Date(Date.now() - ageMs).toISOString()
      : 'invalid'
    executeProviderRequestMock.mockResolvedValue({ bars: [{ timeStamp, close: 100 }] })
    await manager.subscribe(socket, {
      provider: 'yahoo-finance',
      listing,
      channel: 'bars',
      interval,
    })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(executeProviderRequestMock.mock.lastCall?.[1].windows).toEqual([
      mode === 'absolute'
        ? { mode, start: timeStamp, end: new Date().toISOString() }
        : { mode, barCount: 1 },
    ])
    manager.removeSocket(socket.id)
  })

  it('isolates polled candles and their caches by normalization mode', async () => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')
    refreshAccessTokenIfNeededMock.mockResolvedValue('token')
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    for (const [index, normalizationMode] of (
      ['raw', 'split_adjusted', 'raw'] as const
    ).entries()) {
      await manager.subscribe(socket, {
        provider: 'robinhood',
        workspaceId: 'workspace-1',
        listing,
        channel: 'bars',
        interval: '1m',
        normalizationMode,
        clientSubscriptionId: `chart-${index}`,
        providerParams: { credentialId: 'connection' },
      })
      await vi.advanceTimersByTimeAsync(0)
    }
    expect(
      executeProviderRequestMock.mock.calls.map(([, request]) => request.normalizationMode)
    ).toEqual(['raw', 'split_adjusted'])
    expect(
      socket.emit.mock.calls.filter(([event]: [string]) => event === 'market-bar')
    ).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(executeProviderRequestMock).toHaveBeenCalledTimes(4)
    manager.removeSocket(socket.id)
  })

  it.each(['bars', 'quote-snapshots'] as const)('authorizes OAuth %s', async (channel) => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const owner = createSocket('owner-socket')
    const other = { ...createSocket('other-socket'), userId: 'other-user' }
    const payload: MarketSubscribePayload = {
      provider: 'robinhood',
      workspaceId: 'workspace-1',
      listing,
      channel,
      interval: '1m',
      providerParams: { credentialId: 'connection' },
    }
    refreshAccessTokenIfNeededMock.mockResolvedValue('token')
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: false })
    await expect(manager.subscribe(owner, payload)).rejects.toThrow('workspace access')
    expect(refreshAccessTokenIfNeededMock).not.toHaveBeenCalled()

    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    await manager.subscribe(owner, payload)
    refreshAccessTokenIfNeededMock.mockResolvedValueOnce(null)
    await expect(manager.subscribe(other, payload)).rejects.toThrow('Select or reconnect')
    const fetchData = channel === 'bars' ? executeProviderRequestMock : buildMarketQuoteSnapshotMock
    expect(fetchData).toHaveBeenCalledTimes(1)
    expect(other.emit).not.toHaveBeenCalled()
    expect(checkWorkspaceAccessMock).toHaveBeenCalledWith('workspace-1', 'user-1')

    await manager.subscribe(other, payload)
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledWith(
      'connection',
      'other-user',
      expect.any(String),
      'robinhood'
    )
    expect(
      fetchData.mock.calls.map((args) => (channel === 'bars' ? args[2] : args[0].context))
    ).toEqual([{ userId: 'user-1' }, { userId: 'other-user' }])
    manager.removeSocket(other.id)
    await manager.subscribe(owner, {
      ...payload,
      channel: channel === 'bars' ? 'quote-snapshots' : 'bars',
    })
    const fetchOtherData =
      channel === 'bars' ? buildMarketQuoteSnapshotMock : executeProviderRequestMock
    checkWorkspaceAccessMock.mockClear()

    checkWorkspaceAccessMock.mockRejectedValueOnce(new Error('Permission lookup unavailable'))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchData).toHaveBeenCalledTimes(2)
    expect(fetchOtherData).not.toHaveBeenCalled()
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchData).toHaveBeenCalledTimes(3)
    expect(fetchOtherData).toHaveBeenCalledTimes(1)
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(2)

    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchData).toHaveBeenCalledTimes(3)
    expect(fetchOtherData).toHaveBeenCalledTimes(1)
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(3)
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(4)
    expect(manager.unsubscribe(owner, {})).toEqual([])
    expect(owner.emit).toHaveBeenCalledWith(
      'market-error',
      expect.objectContaining({
        message: expect.stringContaining('workspace access'),
      })
    )
  })
})
