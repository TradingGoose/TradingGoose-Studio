/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarketQuoteSnapshot } from '@/lib/market/quote-snapshot-contract'

const {
  getEffectiveDecryptedEnvMock,
  checkWorkspaceAccessMock,
  resolveOAuthCredentialAccountForUserMock,
} = vi.hoisted(() => ({
  getEffectiveDecryptedEnvMock: vi.fn(),
  checkWorkspaceAccessMock: vi.fn(),
  resolveOAuthCredentialAccountForUserMock: vi.fn(),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: checkWorkspaceAccessMock,
}))

vi.mock('@/lib/credentials/oauth', () => ({
  resolveOAuthCredentialAccountForUser: resolveOAuthCredentialAccountForUserMock,
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
  getMarketLiveCapabilitiesMock,
  resolveListingContextMock,
  resolveProviderSymbolMock,
  resolveMarketSessionsForRangeMock,
  alpacaStreamInstances,
  finnhubStreamInstances,
} = vi.hoisted(() => ({
  buildMarketQuoteSnapshotMock: vi.fn(),
  executeProviderRequestMock: vi.fn(),
  getMarketProviderConfigMock: vi.fn(),
  getMarketLiveCapabilitiesMock: vi.fn(),
  resolveListingContextMock: vi.fn(),
  resolveProviderSymbolMock: vi.fn(),
  resolveMarketSessionsForRangeMock: vi.fn(),
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
  getMarketLiveCapabilities: getMarketLiveCapabilitiesMock,
}))

vi.mock('@/providers/market/utils', () => ({
  resolveListingContext: resolveListingContextMock,
  resolveProviderSymbol: resolveProviderSymbolMock,
}))

vi.mock('@/providers/market/market-hours', () => ({
  resolveMarketSessionsForRange: resolveMarketSessionsForRangeMock,
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

const robinhoodBarsPayload: MarketSubscribePayload = {
  provider: 'robinhood',
  workspaceId: 'workspace-1',
  listing,
  channel: 'bars',
  interval: '1m',
  providerParams: { credentialId: 'connection' },
}

const quoteSnapshot = {
  lastPrice: 123.45,
  previousClose: 120,
  change: 3.45,
  changePercent: 2.875,
}

const regularSnapshot = {
  ...quoteSnapshot,
  lastPriceTime: '2026-10-26T15:00:00.000Z',
  lastPriceEndTime: '2026-10-26T15:01:00.000Z',
  timezone: 'America/New_York',
  regularSession: {
    start: '2026-10-26T13:30:00.000Z',
    end: '2026-10-26T20:00:00.000Z',
  },
}

const nativeQuotePayload = (provider: string): MarketSubscribePayload => ({
  provider,
  workspaceId: 'workspace-1',
  listing,
  channel: 'quote-snapshots',
  clientSubscriptionId: 'quote-1',
  auth: { apiKey: 'key', apiSecret: 'secret' },
})

const createSocket = (id: string) =>
  ({
    id,
    userId: 'user-1',
    emit: vi.fn(),
  }) as any

const lastQuote = (socket: ReturnType<typeof createSocket>) =>
  socket.emit.mock.calls.findLast(([event]: [string]) => event === 'market-quote-snapshot')?.[1]
    .snapshot

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
    getMarketLiveCapabilitiesMock.mockImplementation((provider: string) => ({
      pollingIntervalMs:
        provider === 'yahoo-finance'
          ? 5_000
          : provider === 'alpaca' || provider === 'finnhub'
            ? 60_000
            : undefined,
    }))
    resolveMarketSessionsForRangeMock.mockReset().mockResolvedValue(null)
    resolveListingContextMock.mockResolvedValue({
      listing,
      base: 'AAPL',
      assetClass: 'stock',
      timeZoneName: 'America/New_York',
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

  it.each(['alpaca', 'finnhub', 'yahoo-finance'])(
    'replaces stale %s prices with daily change when session metadata is unavailable',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      buildMarketQuoteSnapshotMock.mockResolvedValue(
        createMarketQuoteSnapshot({
          lastPrice: 130,
          lastPriceTime: '2026-10-26T19:59:00Z',
          lastPriceEndTime: '2026-10-26T20:00:00Z',
          timezone: regularSnapshot.timezone,
        })
      )
      await manager.subscribe(socket, nativeQuotePayload(provider))
      await vi.advanceTimersByTimeAsync(0)
      const daily = createMarketQuoteSnapshot({
        lastPrice: 50,
        previousClose: 49,
        lastPriceTime: '2026-10-23T04:00:00Z',
        lastPriceEndTime: '2026-10-24T04:00:00Z',
        timezone: regularSnapshot.timezone,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(daily)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(daily)
      if (provider !== 'yahoo-finance') {
        const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
        const trade = (timeStamp: string) =>
          stream.handlers.onTrade({ symbol: 'AAPL', trade: { price: 133, timeStamp } })
        await trade('invalid')
        expect(lastQuote(socket)).toEqual(daily)
        expect(resolveMarketSessionsForRangeMock).not.toHaveBeenCalled()
        resolveMarketSessionsForRangeMock.mockRejectedValueOnce(new Error('Calendar unavailable'))
        await trade('2026-10-27T12:00:00Z')
        expect(lastQuote(socket)).toEqual(daily)
        await vi.advanceTimersByTimeAsync(15_000)
        const regularSession = { start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' }
        resolveMarketSessionsForRangeMock.mockResolvedValueOnce([
          { type: 'market', ...regularSession },
        ])
        await trade('2026-10-27T14:00:00Z')
        expect(lastQuote(socket)).toMatchObject({
          lastPrice: 133,
          previousClose: null,
          change: null,
          changePercent: null,
          regularSession,
        })
      }
      manager.removeSocket(socket.id)
    }
  )

  it.each(['yahoo-finance', 'alpha-vantage', 'robinhood'])(
    'preserves active %s prices through daily refreshes and accepts completed closes',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-26T16:00:00Z'))
      checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
      refreshAccessTokenIfNeededMock.mockResolvedValue('token')
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      const current = createMarketQuoteSnapshot(regularSnapshot)
      buildMarketQuoteSnapshotMock.mockResolvedValue(current)
      await manager.subscribe(socket, {
        ...nativeQuotePayload(provider),
        providerParams: { credentialId: 'connection' },
      })
      await vi.advanceTimersByTimeAsync(0)
      const daily = createMarketQuoteSnapshot({
        lastPrice: 110,
        previousClose: 100,
        lastPriceTime: '2026-10-23T04:00:00Z',
        lastPriceEndTime: '2026-10-23T20:00:00Z',
        timezone: current.timezone,
        regularSession: { start: '2026-10-23T13:30:00Z', end: '2026-10-23T20:00:00Z' },
        error: 'Intraday unavailable',
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(daily)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(current)
      buildMarketQuoteSnapshotMock.mockResolvedValue(
        createMarketQuoteSnapshot({
          ...daily,
          previousClose: current.previousClose,
          lastPriceTime: '2026-10-26T04:00:00Z',
          lastPriceEndTime: undefined,
          regularSession: current.regularSession,
        })
      )
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual({ ...current, error: daily.error })
      const newer = createMarketQuoteSnapshot({
        ...current,
        lastPrice: 124,
        lastPriceTime: '2026-10-26T15:01:00Z',
        lastPriceEndTime: '2026-10-26T15:02:00Z',
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(newer)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(newer)
      vi.setSystemTime(new Date(current.regularSession!.end))
      buildMarketQuoteSnapshotMock.mockResolvedValue(daily)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(daily)
      for (const lastPrice of [130, 131]) {
        const completed = createMarketQuoteSnapshot({
          ...current,
          lastPrice,
          lastPriceTime: '2026-10-26T04:00:00Z',
          lastPriceEndTime: current.regularSession!.end,
        })
        buildMarketQuoteSnapshotMock.mockResolvedValue(completed)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(lastQuote(socket)).toEqual(completed)
      }
      manager.removeSocket(socket.id)
    }
  )

  it.each(['alpaca', 'finnhub'])(
    'validates %s same-day trades when the daily quote has no session metadata',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-27T21:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      const daily = createMarketQuoteSnapshot({
        lastPrice: 105,
        previousClose: 100,
        lastPriceTime: '2026-10-27T04:00:00Z',
        timezone: regularSnapshot.timezone,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(daily)
      await manager.subscribe(socket, nativeQuotePayload(provider))
      await vi.advanceTimersByTimeAsync(0)
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      resolveMarketSessionsForRangeMock.mockRejectedValueOnce(new Error('Calendar unavailable'))
      await trade(999, '2026-10-27T21:00:00Z')
      expect(lastQuote(socket)).toEqual(daily)
      await trade(999, '2026-10-27T21:00:01Z')
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15_000)
      resolveMarketSessionsForRangeMock.mockResolvedValueOnce([])
      await trade(999, '2026-10-27T21:00:15Z')
      expect(lastQuote(socket)).toEqual(daily)
      await vi.advanceTimersByTimeAsync(15_000)
      const regularSession = { start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' }
      resolveMarketSessionsForRangeMock.mockResolvedValueOnce([
        { type: 'market', ...regularSession },
      ])
      await trade(106, '2026-10-27T19:59:00Z')
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 106,
        previousClose: 100,
        change: 6,
        changePercent: 6,
        regularSession,
      })
      manager.removeSocket(socket.id)
    }
  )

  it.each([
    ['robinhood', 'disconnect'],
    ['alpaca', 'unsubscribe'],
    ['finnhub', 'unsubscribe'],
  ])('cancels pending %s setup on %s', async (provider, action) => {
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    refreshAccessTokenIfNeededMock.mockResolvedValue('token')
    resolveListingContextMock.mockImplementationOnce(async () => {
      if (action === 'disconnect') manager.removeSocket(socket.id)
      else manager.unsubscribe(socket, { clientSubscriptionId: 'chart' })
      return { listing, base: 'AAPL', assetClass: 'stock' }
    })
    await expect(
      manager.subscribe(socket, {
        provider,
        listing,
        workspaceId: 'workspace-1',
        channel: 'bars',
        interval: '1m',
        clientSubscriptionId: 'chart',
        providerParams: { credentialId: 'connection' },
        auth: { apiKey: 'key', apiSecret: 'secret' },
      })
    ).rejects.toThrow()
    expect(manager.unsubscribe(socket, {})).toEqual([])
  })

  it('preserves unrelated pending subscriptions and a replacement after cancellation', async () => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const socket = createSocket('socket-1')
    let resolveListing!: (context: unknown) => void
    resolveListingContextMock.mockReturnValue(
      new Promise((resolve) => {
        resolveListing = resolve
      })
    )
    const payload = { provider: 'yahoo-finance', listing, clientSubscriptionId: 'chart' }
    const pending = manager.subscribe(socket, payload)
    const cancelled = expect(pending).rejects.toThrow()
    const other = manager.subscribe(socket, { ...payload, clientSubscriptionId: 'other' })
    await vi.advanceTimersByTimeAsync(0)
    manager.unsubscribe(socket, { clientSubscriptionId: 'chart' })
    const replacement = manager.subscribe(socket, payload)
    resolveListing({ listing, base: 'AAPL', assetClass: 'stock' })
    await Promise.all([cancelled, other, replacement])
    expect(manager.unsubscribe(socket, {}).map((record) => record.clientSubscriptionId)).toEqual([
      'other',
      'chart',
    ])
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
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalled()

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

  it.each(['alpaca', 'finnhub'])(
    'seeds %s quotes and keeps daily change tied to its regular session',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      await manager.subscribe(socket, nativeQuotePayload(provider))
      for (const channel of ['bars', 'trades'] as const) {
        await manager.subscribe(socket, {
          ...nativeQuotePayload(provider),
          channel,
          interval: '1m',
          clientSubscriptionId: channel,
        })
      }
      await vi.advanceTimersByTimeAsync(0)
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      expect(lastQuote(socket)).toEqual(regularSnapshot)
      trade(124, '2026-10-26T15:01:00.000Z')
      trade(126, '2026-10-26T15:01:00.000Z')
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 126,
        previousClose: 120,
        change: 6,
        changePercent: 5,
      })
      expect(lastQuote(socket).lastPriceEndTime).toBeUndefined()
      trade(132, '2026-10-26T15:02:00.000Z')
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 132,
        previousClose: 120,
        change: 12,
        changePercent: 10,
      })
      socket.emit.mockClear()
      for (const timeStamp of [
        '2026-10-26T13:00:00Z',
        '2026-10-26T15:01:00Z',
        '2026-10-26T20:00:00Z',
        '2026-10-27T12:00:00Z',
        'invalid',
      ]) {
        trade(200, timeStamp)
      }
      expect(lastQuote(socket)).toBeUndefined()
      expect(
        socket.emit.mock.calls.filter(([event]: [string]) => event === 'market-trade')
      ).toHaveLength(5)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({ lastPrice: 132, previousClose: 120, change: 12 })
      buildMarketQuoteSnapshotMock.mockRejectedValueOnce(new Error('429 Too Many Requests'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 132,
        previousClose: 120,
        change: 12,
        error: '429 Too Many Requests',
      })
      socket.emit.mockClear()
      trade(200, '2026-10-26T20:01:00Z')
      trade(200, '2026-10-27T12:00:00Z')
      trade(133, '2026-10-27T14:00:00Z')
      expect(lastQuote(socket)).toBeUndefined()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 132,
        previousClose: 120,
        change: 12,
        regularSession: regularSnapshot.regularSession,
      })
      const nextSessionSnapshot = {
        lastPrice: 130,
        previousClose: 129,
        change: 1,
        changePercent: 100 / 129,
        lastPriceTime: '2026-10-27T15:00:00Z',
        lastPriceEndTime: '2026-10-27T15:01:00Z',
        timezone: 'America/New_York',
        regularSession: { start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' },
      }
      buildMarketQuoteSnapshotMock.mockResolvedValue(nextSessionSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({ lastPrice: 130, previousClose: 129, change: 1 })
      expect(lastQuote(socket).error).toBeUndefined()
      trade(132, '2026-10-27T15:01:00Z')
      expect(lastQuote(socket)).toMatchObject({ lastPrice: 132, previousClose: 129, change: 3 })
      trade(125, '2026-10-27T19:59:10Z')
      const completedSnapshot = {
        ...nextSessionSnapshot,
        lastPriceTime: '2026-10-27T19:59:00Z',
        lastPriceEndTime: '2026-10-27T20:00:00Z',
      }
      for (const [lastPrice, lastPriceTime, lastPriceEndTime] of [
        [130, '2026-10-27T19:59:00Z', '2026-10-27T20:00:00Z'],
        [124, '2026-10-27T19:58:00Z', '2026-10-27T19:59:00Z'],
        [124, '2026-10-27T19:59:00Z', '2026-10-27T19:59:30Z'],
      ] as const) {
        buildMarketQuoteSnapshotMock.mockResolvedValue(
          createMarketQuoteSnapshot({
            ...completedSnapshot,
            lastPrice,
            lastPriceTime,
            lastPriceEndTime,
          })
        )
        await vi.advanceTimersByTimeAsync(60_000)
        expect(lastQuote(socket)).toEqual(completedSnapshot)
        trade(125, '2026-10-27T19:59:59.999Z')
        expect(lastQuote(socket)).toEqual(completedSnapshot)
      }
      const correctedSnapshot = createMarketQuoteSnapshot({ ...completedSnapshot, lastPrice: 131 })
      buildMarketQuoteSnapshotMock.mockResolvedValue(correctedSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(correctedSnapshot)
      expect(executeProviderRequestMock).not.toHaveBeenCalled()
      manager.removeSocket(socket.id)
    }
  )

  it.each(['alpaca', 'finnhub'])(
    'resolves the next %s regular session when historical refreshes fail',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-27T14:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      buildMarketQuoteSnapshotMock.mockResolvedValue({
        ...regularSnapshot,
        volume: 10,
        volumeUsd: 1234.5,
      })
      await manager.subscribe(socket, nativeQuotePayload(provider))
      await vi.advanceTimersByTimeAsync(0)
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      const session = { type: 'market', start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' }
      resolveMarketSessionsForRangeMock.mockResolvedValue([session])
      buildMarketQuoteSnapshotMock.mockRejectedValue(new Error('Historical access denied'))
      await vi.advanceTimersByTimeAsync(60_000)
      await trade(200, '2026-10-27T12:00:00Z')
      await trade(200, '2026-10-27T20:00:00Z')
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(15_000)
      resolveMarketSessionsForRangeMock.mockResolvedValueOnce([])
      await trade(200, '2026-10-31T14:00:00Z')
      await vi.advanceTimersByTimeAsync(15_000)
      resolveMarketSessionsForRangeMock.mockRejectedValueOnce(new Error('Calendar unavailable'))
      await trade(200, '2026-10-27T14:00:00Z')
      await vi.advanceTimersByTimeAsync(14_999)
      await trade(200, '2026-10-27T14:00:00Z')
      expect(lastQuote(socket).lastPrice).toBe(regularSnapshot.lastPrice)
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(1)
      await trade(133, '2026-10-27T14:00:00Z')
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 133,
        previousClose: null,
        change: null,
        changePercent: null,
        regularSession: { start: session.start, end: session.end },
        error: 'Historical access denied',
      })
      expect(lastQuote(socket).volume).toBeUndefined()
      expect(lastQuote(socket).volumeUsd).toBeUndefined()
      await trade(133, '2026-10-27T14:00:01Z')
      expect(lastQuote(socket).lastPriceTime).toBe('2026-10-27T14:00:01Z')
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(4)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket).lastPrice).toBe(133)
      const dailyQuote = createMarketQuoteSnapshot({
        lastPrice: 130,
        previousClose: 129,
        volume: 20,
        lastPriceTime: '2026-10-26T04:00:00Z',
        timezone: regularSnapshot.timezone,
        error: 'Intraday premium access required',
      })
      buildMarketQuoteSnapshotMock.mockResolvedValueOnce(dailyQuote)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 133,
        previousClose: null,
        change: null,
        regularSession: { start: session.start, end: session.end },
      })
      buildMarketQuoteSnapshotMock.mockResolvedValueOnce({
        ...dailyQuote,
        lastPriceTime: '2026-10-27T04:00:00Z',
      })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 133,
        previousClose: 129,
        change: 4,
        volume: 20,
        volumeUsd: 2660,
        regularSession: { start: session.start, end: session.end },
        error: dailyQuote.error,
      })
      const recovered = createMarketQuoteSnapshot({
        lastPrice: 134,
        previousClose: 129,
        volume: 20,
        lastPriceTime: '2026-10-27T14:01:00Z',
        lastPriceEndTime: '2026-10-27T14:02:00Z',
        timezone: regularSnapshot.timezone,
        regularSession: session,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(recovered)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(recovered)
      const original = structuredClone(recovered)
      buildMarketQuoteSnapshotMock.mockResolvedValueOnce(regularSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(original)
      expect(recovered).toEqual(original)

      vi.setSystemTime(new Date(session.end))
      const completedDaily = createMarketQuoteSnapshot({
        lastPrice: 65,
        previousClose: 64,
        lastPriceTime: '2026-10-26T04:00:00Z',
        lastPriceEndTime: '2026-10-27T04:00:00Z',
        timezone: regularSnapshot.timezone,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(completedDaily)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toEqual(completedDaily)
      for (const lastPrice of [67, 68]) {
        const latestDaily = createMarketQuoteSnapshot({
          ...completedDaily,
          lastPrice,
          previousClose: 65,
          lastPriceTime: '2026-10-27T04:00:00Z',
          lastPriceEndTime: session.end,
          regularSession: { start: session.start, end: session.end },
        })
        buildMarketQuoteSnapshotMock.mockResolvedValue(latestDaily)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(lastQuote(socket)).toEqual(latestDaily)
      }
      manager.removeSocket(socket.id)
    }
  )

  it.each([
    ['trade', true],
    ['poll', true],
    ['refresh', true],
    ['refresh', false],
    ['unsubscribe', true],
  ] as const)(
    'does not overwrite a newer %s while resolving an overnight session (found=%s)',
    async (winner, found) => {
      vi.useFakeTimers()
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      await manager.subscribe(socket, nativeQuotePayload('alpaca'))
      await manager.subscribe(socket, {
        ...nativeQuotePayload('alpaca'),
        channel: 'trades',
        clientSubscriptionId: 'trades',
      })
      await vi.advanceTimersByTimeAsync(0)
      const session = { type: 'market', start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' }
      let resolveSession!: (sessions: (typeof session)[]) => void
      resolveMarketSessionsForRangeMock.mockResolvedValue([session]).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSession = resolve
        })
      )
      const trade = (price: number, timeStamp: string) =>
        alpacaStreamInstances[0].handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      socket.emit.mockClear()
      const pending = trade(133, '2026-10-27T14:00:00Z')
      expect(socket.emit).toHaveBeenCalledWith(
        'market-trade',
        expect.objectContaining({ trade: { price: 133, timeStamp: '2026-10-27T14:00:00Z' } })
      )
      if (winner === 'poll') await vi.advanceTimersByTimeAsync(60_000)
      const newerTrade =
        winner === 'trade' || winner === 'poll' ? trade(134, '2026-10-27T14:01:00Z') : undefined
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(1)
      if (winner === 'refresh') {
        buildMarketQuoteSnapshotMock.mockResolvedValue(
          createMarketQuoteSnapshot({
            lastPrice: 134,
            previousClose: 129,
            lastPriceTime: '2026-10-27T14:01:00Z',
            lastPriceEndTime: '2026-10-27T14:02:00Z',
            timezone: regularSnapshot.timezone,
            regularSession: session,
          })
        )
        await vi.advanceTimersByTimeAsync(60_000)
      }
      if (winner === 'unsubscribe') {
        manager.removeSocket(socket.id)
        socket.emit.mockClear()
      }
      resolveSession(found ? [session] : [])
      await Promise.all([pending, newerTrade])
      if (winner === 'unsubscribe') expect(socket.emit).not.toHaveBeenCalled()
      else {
        expect(lastQuote(socket)).toMatchObject({
          lastPrice: 134,
          previousClose: winner === 'refresh' ? 129 : null,
        })
      }
      manager.removeSocket(socket.id)
    }
  )

  it.each(['miss', 'inflight'])(
    'clears a %s session lookup when its last symbol subscriber leaves',
    async (result) => {
      vi.useFakeTimers()
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      const first = await manager.subscribe(socket, nativeQuotePayload('alpaca'))
      resolveProviderSymbolMock.mockReturnValueOnce('MSFT')
      await manager.subscribe(socket, {
        ...nativeQuotePayload('alpaca'),
        listing: { ...listing, listing_id: 'us-msft' },
        clientSubscriptionId: 'other-symbol',
      })
      await vi.advanceTimersByTimeAsync(0)
      let resolveLookup!: (sessions: []) => void
      resolveMarketSessionsForRangeMock.mockImplementationOnce(() =>
        result === 'miss'
          ? Promise.resolve([])
          : new Promise((resolve) => {
              resolveLookup = resolve
            })
      )
      const trade = () =>
        alpacaStreamInstances[0].handlers.onTrade({
          symbol: 'AAPL',
          trade: { price: 133, timeStamp: '2026-10-27T14:00:00Z' },
        })
      const pending = trade()
      if (result === 'miss') await pending
      manager.unsubscribe(socket, { subscriptionId: first.subscriptionId })
      await manager.subscribe(socket, {
        ...nativeQuotePayload('alpaca'),
        clientSubscriptionId: 'replacement',
      })
      await vi.advanceTimersByTimeAsync(0)
      if (result === 'inflight') {
        resolveLookup([])
        await pending
      }
      resolveMarketSessionsForRangeMock.mockResolvedValueOnce([
        { type: 'market', start: '2026-10-27T13:30:00Z', end: '2026-10-27T20:00:00Z' },
      ])
      await trade()
      expect(resolveMarketSessionsForRangeMock).toHaveBeenCalledTimes(2)
      expect(lastQuote(socket)).toMatchObject({ lastPrice: 133, previousClose: null })
      manager.removeSocket(socket.id)
    }
  )

  it.each([false, true])(
    'accepts a corrected close after session metadata recovers (partial=%s)',
    async (partial) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-27T12:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      const inferred = createMarketQuoteSnapshot({
        lastPrice: 130,
        previousClose: 120,
        lastPriceTime: '2026-10-26T19:59:00Z',
        lastPriceEndTime: '2026-10-27T04:00:00Z',
        timezone: 'America/New_York',
      })
      const corrected = createMarketQuoteSnapshot({
        ...inferred,
        lastPrice: 131,
        lastPriceEndTime: regularSnapshot.regularSession.end,
        regularSession: regularSnapshot.regularSession,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(inferred)
      await manager.subscribe(socket, nativeQuotePayload('alpaca'))
      await vi.advanceTimersByTimeAsync(0)
      expect(lastQuote(socket)).toEqual(inferred)
      if (partial) {
        buildMarketQuoteSnapshotMock.mockResolvedValue(
          createMarketQuoteSnapshot({
            ...corrected,
            lastPrice: 124,
            lastPriceEndTime: '2026-10-26T19:59:30Z',
          })
        )
        await vi.advanceTimersByTimeAsync(60_000)
        expect(lastQuote(socket)).toEqual(
          createMarketQuoteSnapshot({ ...corrected, lastPrice: 130 })
        )
      }
      buildMarketQuoteSnapshotMock.mockResolvedValue(corrected)
      for (let refresh = 0; refresh < 2; refresh++) {
        await vi.advanceTimersByTimeAsync(60_000)
        expect(lastQuote(socket)).toEqual(corrected)
      }
      expect(lastQuote(socket).change).toBe(11)
      expect(inferred.lastPriceEndTime).toBe('2026-10-27T04:00:00Z')
      manager.removeSocket(socket.id)
    }
  )

  it.each(['alpaca', 'finnhub'])(
    'keeps %s live prices before seeding and through historical failures',
    async (provider) => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      let rejectSeed!: (error: Error) => void
      buildMarketQuoteSnapshotMock
        .mockRejectedValue(new Error('Historical access denied'))
        .mockReturnValueOnce(
          new Promise((_, reject) => {
            rejectSeed = reject
          })
        )
      await manager.subscribe(socket, nativeQuotePayload(provider))
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      trade(123.45, '2026-10-26T15:01:00Z')
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 123.45,
        previousClose: null,
        change: null,
      })
      rejectSeed(new Error('Historical access denied'))
      await vi.advanceTimersByTimeAsync(0)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 123.45,
        error: 'Historical access denied',
      })
      trade(126, '2026-10-26T15:02:00Z')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 126,
        previousClose: null,
        change: null,
        error: 'Historical access denied',
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({ lastPrice: 126, previousClose: 120, change: 6 })
      expect(lastQuote(socket).error).toBeUndefined()
      manager.removeSocket(socket.id)
    }
  )

  it.each(['currency', 'crypto'] as const)(
    'updates %s prices across UTC days without reusing an obsolete baseline',
    async (listing_type) => {
      vi.useFakeTimers()
      const pair = { listing_id: '', base_id: 'EUR', quote_id: 'USD', listing_type }
      resolveListingContextMock.mockResolvedValue({
        listing: pair,
        base: 'EUR',
        quote: 'USD',
        assetClass: listing_type,
      })
      const seed = createMarketQuoteSnapshot({
        lastPrice: 1.08,
        previousClose: 1.07,
        lastPriceTime: '2026-10-26T23:59:00Z',
        lastPriceEndTime: '2026-10-27T00:00:00Z',
        timezone: 'UTC',
        volume: 100,
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(seed)
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      await manager.subscribe(socket, { ...nativeQuotePayload('finnhub'), listing: pair })
      await vi.advanceTimersByTimeAsync(0)
      const trade = (price: number, timeStamp: string) =>
        finnhubStreamInstances[0].handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      trade(1.09, '2026-10-26T23:59:00Z')
      expect(lastQuote(socket).lastPrice).toBe(1.08)
      expect(lastQuote(socket).change).toBeCloseTo(0.01)
      expect(lastQuote(socket).volumeUsd).toBeCloseTo(108)
      trade(1.1, '2026-10-27T00:00:00Z')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket)).toMatchObject({
        lastPrice: 1.1,
        previousClose: null,
        change: null,
        timezone: 'UTC',
      })
      expect(lastQuote(socket).volumeUsd).toBeUndefined()
      expect(lastQuote(socket).lastPriceEndTime).toBeUndefined()
      buildMarketQuoteSnapshotMock.mockResolvedValue(
        createMarketQuoteSnapshot({
          lastPrice: 1.1,
          previousClose: 1.09,
          lastPriceTime: '2026-10-27T00:00:00Z',
          lastPriceEndTime: '2026-10-27T00:01:00Z',
          timezone: 'UTC',
        })
      )
      await vi.advanceTimersByTimeAsync(60_000)
      expect(lastQuote(socket).previousClose).toBe(1.09)
      expect(lastQuote(socket).change).toBeCloseTo(0.01)
      trade(1.11, '2026-10-27T00:01:00Z')
      expect(lastQuote(socket).lastPrice).toBe(1.11)
      expect(lastQuote(socket).change).toBeCloseTo(0.02)
      manager.removeSocket(socket.id)
    }
  )

  it.each(['alpaca', 'finnhub'])(
    'rejects unconfigured %s subscriptions before sharing a configured quote',
    async (provider) => {
      vi.useFakeTimers()
      const manager = new MarketStreamManager()
      const configured = createSocket('configured')
      const unconfigured = createSocket('unconfigured')
      await manager.subscribe(configured, nativeQuotePayload(provider))
      await expect(
        manager.subscribe(unconfigured, {
          ...nativeQuotePayload(provider),
          auth: undefined,
        })
      ).rejects.toThrow(/required/)
      await vi.advanceTimersByTimeAsync(0)
      expect(unconfigured.emit).not.toHaveBeenCalled()
      expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(1)
      manager.removeSocket(configured.id)
    }
  )

  it.each(['subscriber', 'stream', 'anchor'])(
    'discards a removed %s response and keeps remaining subscribers refreshed',
    async (removed) => {
      vi.useFakeTimers()
      const manager = new MarketStreamManager()
      const socket = createSocket('socket-1')
      let resolveSnapshot!: (snapshot: typeof regularSnapshot) => void
      const pendingSnapshot = () =>
        new Promise((resolve) => {
          resolveSnapshot = resolve
        })
      if (removed !== 'anchor') buildMarketQuoteSnapshotMock.mockImplementationOnce(pendingSnapshot)
      const first = await manager.subscribe(socket, nativeQuotePayload('alpaca'))
      if (removed !== 'stream') {
        await manager.subscribe(socket, {
          ...nativeQuotePayload('alpaca'),
          clientSubscriptionId: 'anchor',
        })
      }
      if (removed === 'anchor') {
        await vi.advanceTimersByTimeAsync(0)
        buildMarketQuoteSnapshotMock.mockImplementationOnce(pendingSnapshot)
        await vi.advanceTimersByTimeAsync(60_000)
      }
      manager.unsubscribe(socket, { subscriptionId: first.subscriptionId })
      if (removed !== 'anchor') {
        await manager.subscribe(socket, {
          ...nativeQuotePayload('alpaca'),
          clientSubscriptionId: 'replacement',
        })
      }
      resolveSnapshot({ ...regularSnapshot, lastPrice: 999 })
      await vi.advanceTimersByTimeAsync(0)
      expect(socket.emit).not.toHaveBeenCalledWith(
        'market-quote-snapshot',
        expect.objectContaining({
          snapshot: expect.objectContaining({ lastPrice: 999 }),
        })
      )
      expect(socket.emit).toHaveBeenCalledWith(
        'market-quote-snapshot',
        expect.objectContaining({
          clientSubscriptionId: removed === 'anchor' ? 'anchor' : 'replacement',
          snapshot: quoteSnapshot,
        })
      )
      const calls = buildMarketQuoteSnapshotMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(60_000)
      expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(calls + 1)
      manager.removeSocket(socket.id)
    }
  )

  it.each([
    ['alpaca', 26, 60_000],
    ['alpaca', 30, 60_000],
    ['finnhub', 31, 60_000],
    ['alpaca', 51, 180_000],
  ] as const)(
    'refreshes %s %s quote symbols at the configured %sms cadence',
    async (provider, count, interval) => {
      vi.useFakeTimers()
      getMarketLiveCapabilitiesMock.mockReturnValue({ pollingIntervalMs: interval })
      const manager = new MarketStreamManager()
      const socket = createSocket('watchlist')
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      for (let index = 0; index < count; index++) {
        resolveProviderSymbolMock.mockReturnValueOnce(`SYMBOL${index}`)
        await manager.subscribe(socket, {
          ...nativeQuotePayload(provider),
          listing: { ...listing, listing_id: `listing-${index}` },
          clientSubscriptionId: `quote-${index}`,
        })
        await vi.advanceTimersByTimeAsync(0)
      }
      resolveProviderSymbolMock.mockReturnValueOnce('SYMBOL0')
      await manager.subscribe(socket, {
        ...nativeQuotePayload(provider),
        listing: { ...listing, listing_id: 'listing-0' },
        clientSubscriptionId: 'duplicate',
      })
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      stream.handlers.onTrade({
        symbol: 'SYMBOL0',
        trade: { price: 126, timeStamp: '2026-10-26T15:01:00Z' },
      })
      await vi.advanceTimersByTimeAsync(interval - 1)
      expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(count)
      await vi.advanceTimersByTimeAsync(1)
      expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(count * 2)
      manager.removeSocket(socket.id)
    }
  )

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

  it('reuses fresh quotes and refreshes staggered symbols at their own deadlines', async () => {
    vi.useFakeTimers()
    getMarketLiveCapabilitiesMock.mockReturnValue({ pollingIntervalMs: 15_000 })
    const manager = new MarketStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')
    const consumers = [
      [firstSocket, 'quote-1'],
      [secondSocket, 'quote-2'],
    ] as const
    buildMarketQuoteSnapshotMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(quoteSnapshot), 100))
    )

    for (const [socket, clientSubscriptionId] of consumers) {
      await manager.subscribe(socket, {
        provider: 'yahoo-finance',
        workspaceId: 'workspace-1',
        listing,
        channel: 'quote-snapshots',
        clientSubscriptionId,
      })
    }

    await vi.advanceTimersByTimeAsync(100)

    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(1)
    for (const [socket, clientSubscriptionId] of consumers) {
      expect(socket.emit).toHaveBeenCalledWith(
        'market-quote-snapshot',
        expect.objectContaining({
          provider: 'yahoo-finance',
          channel: 'quote-snapshots',
          clientSubscriptionId,
          snapshot: quoteSnapshot,
        })
      )
    }

    await vi.advanceTimersByTimeAsync(900)
    const newListing = { ...listing, listing_id: 'us-msft' }
    resolveProviderSymbolMock.mockReturnValueOnce('MSFT')
    await manager.subscribe(firstSocket, {
      ...nativeQuotePayload('yahoo-finance'),
      listing: newListing,
      auth: undefined,
      clientSubscriptionId: 'msft',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledWith(
      expect.objectContaining({ listing: newListing })
    )
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'market-quote-snapshot',
      expect.objectContaining({
        clientSubscriptionId: 'msft',
        snapshot: quoteSnapshot,
      })
    )
    buildMarketQuoteSnapshotMock.mockClear()
    await vi.advanceTimersByTimeAsync(14_000)
    expect(
      buildMarketQuoteSnapshotMock.mock.calls.map(([args]) => args.listing.listing_id)
    ).toEqual([listing.listing_id])
    await vi.advanceTimersByTimeAsync(999)
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(
      buildMarketQuoteSnapshotMock.mock.calls.map(([args]) => args.listing.listing_id)
    ).toEqual([listing.listing_id, newListing.listing_id])

    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('deduplicates polled bars and keeps their cadence through staggered quote refreshes', async () => {
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
    await vi.advanceTimersByTimeAsync(1_000)
    resolveProviderSymbolMock.mockReturnValueOnce('MSFT')
    await manager.subscribe(firstSocket, {
      ...nativeQuotePayload('yahoo-finance'),
      listing: { ...listing, listing_id: 'us-msft' },
      auth: undefined,
      clientSubscriptionId: 'quote',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(executeProviderRequestMock).toHaveBeenCalledTimes(1)

    executeProviderRequestMock.mockClear()
    firstSocket.emit.mockClear()
    secondSocket.emit.mockClear()
    vi.advanceTimersByTime(4_000)
    await Promise.resolve()
    await Promise.resolve()

    expect(executeProviderRequestMock).toHaveBeenCalledTimes(1)
    expect(firstSocket.emit).not.toHaveBeenCalled()
    expect(secondSocket.emit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(2)
    expect(executeProviderRequestMock).toHaveBeenCalledTimes(1)

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
    await manager.subscribe(socket, { ...robinhoodBarsPayload, clientSubscriptionId: 'chart' })
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
    ['1m', 1999 * 60_000, 1999 * 60_000],
    ['1m', 3932 * 60_000, 2000 * 60_000],
    ['1d', 2000 * 60_000, 2000 * 60_000],
    ['1m', -60_000, null],
    ['1m', Number.NaN, null],
    ['invalid', 60_000, null],
  ] as const)('bounds recovery for %s with cached age %s', async (interval, ageMs, span) => {
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
      span === null
        ? { mode: 'bars', barCount: 1 }
        : {
            mode: 'absolute',
            start: span === ageMs ? timeStamp : new Date(Date.now() - span).toISOString(),
            end: new Date().toISOString(),
          },
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
        ...robinhoodBarsPayload,
        normalizationMode,
        clientSubscriptionId: `chart-${index}`,
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
      ...robinhoodBarsPayload,
      channel,
    }
    const sharedPayload = {
      ...payload,
      providerParams: { credentialId: 'workspace-credential' },
    }
    refreshAccessTokenIfNeededMock.mockResolvedValue('token')
    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: false })
    await expect(manager.subscribe(owner, payload)).rejects.toThrow('workspace access')
    expect(refreshAccessTokenIfNeededMock).not.toHaveBeenCalled()

    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: true })
    await manager.subscribe(owner, payload)
    resolveOAuthCredentialAccountForUserMock.mockResolvedValue({
      credentialId: 'workspace-credential',
      accountId: 'connection',
      credentialOwnerUserId: 'user-1',
      providerId: 'robinhood',
      workspaceId: 'workspace-1',
    })
    const fetchData = channel === 'bars' ? executeProviderRequestMock : buildMarketQuoteSnapshotMock
    expect(fetchData).toHaveBeenCalledTimes(1)
    expect(checkWorkspaceAccessMock).toHaveBeenCalledWith('workspace-1', 'user-1')

    await manager.subscribe(other, sharedPayload, 'workspace')
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledWith(
      'connection',
      'user-1',
      expect.any(String),
      'robinhood'
    )
    expect(
      fetchData.mock.calls.map((args) => (channel === 'bars' ? args[2] : args[0].context))
    ).toEqual([{ userId: 'user-1' }, { userId: 'user-1' }])
    expect(resolveOAuthCredentialAccountForUserMock).toHaveBeenCalledWith({
      credentialId: 'workspace-credential',
      userId: 'other-user',
      workspaceId: 'workspace-1',
    })
    resolveOAuthCredentialAccountForUserMock.mockResolvedValue(null)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(other.emit).toHaveBeenCalledWith(
      'market-error',
      expect.objectContaining({ message: 'Market connection access was revoked' })
    )
    expect(manager.unsubscribe(other, {})).toEqual([])
    executeProviderRequestMock.mockClear()
    buildMarketQuoteSnapshotMock.mockClear()
    await manager.subscribe(owner, {
      ...payload,
      channel: channel === 'bars' ? 'quote-snapshots' : 'bars',
    })
    await vi.advanceTimersByTimeAsync(0)
    executeProviderRequestMock.mockClear()
    buildMarketQuoteSnapshotMock.mockClear()
    const fetchOtherData =
      channel === 'bars' ? buildMarketQuoteSnapshotMock : executeProviderRequestMock
    checkWorkspaceAccessMock.mockClear()

    checkWorkspaceAccessMock.mockRejectedValueOnce(new Error('Permission lookup unavailable'))
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchData).not.toHaveBeenCalled()
    expect(fetchOtherData).not.toHaveBeenCalled()
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(fetchData).toHaveBeenCalledTimes(1)
    expect(fetchOtherData).toHaveBeenCalledTimes(1)
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(2)

    checkWorkspaceAccessMock.mockResolvedValue({ exists: true, hasAccess: false })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fetchData).toHaveBeenCalledTimes(1)
    expect(fetchOtherData).toHaveBeenCalledTimes(1)
    expect(checkWorkspaceAccessMock).toHaveBeenCalledTimes(3)
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(3)
    expect(manager.unsubscribe(owner, {})).toEqual([])
    expect(owner.emit).toHaveBeenCalledWith(
      'market-error',
      expect.objectContaining({
        message: expect.stringContaining('access was revoked'),
      })
    )
  })
})
