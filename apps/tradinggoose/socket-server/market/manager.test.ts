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
      provider === 'yahoo-finance'
        ? 5_000
        : provider === 'alpaca' || provider === 'finnhub'
          ? 60_000
          : undefined
    )
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
      const quote = () =>
        socket.emit.mock.calls.findLast(
          ([event]: [string]) => event === 'market-quote-snapshot'
        )?.[1].snapshot
      const stream = (provider === 'alpaca' ? alpacaStreamInstances : finnhubStreamInstances)[0]
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      expect(quote()).toEqual(regularSnapshot)
      trade(124, '2026-10-26T15:01:00.000Z')
      trade(126, '2026-10-26T15:01:00.000Z')
      expect(quote()).toMatchObject({
        lastPrice: 126,
        previousClose: 120,
        change: 6,
        changePercent: 5,
      })
      expect(quote().lastPriceEndTime).toBeUndefined()
      trade(132, '2026-10-26T15:02:00.000Z')
      expect(quote()).toMatchObject({
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
      ]) {
        trade(200, timeStamp)
      }
      expect(quote()).toBeUndefined()
      expect(
        socket.emit.mock.calls.filter(([event]: [string]) => event === 'market-trade')
      ).toHaveLength(4)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({ lastPrice: 132, previousClose: 120, change: 12 })
      buildMarketQuoteSnapshotMock.mockRejectedValueOnce(new Error('429 Too Many Requests'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({
        lastPrice: 132,
        previousClose: 120,
        change: 12,
        error: '429 Too Many Requests',
      })
      socket.emit.mockClear()
      trade(200, '2026-10-26T20:01:00Z')
      trade(200, '2026-10-27T12:00:00Z')
      trade(133, '2026-10-27T14:00:00Z')
      expect(quote()).toBeUndefined()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({
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
      expect(quote()).toMatchObject({ lastPrice: 130, previousClose: 129, change: 1 })
      expect(quote().error).toBeUndefined()
      trade(132, '2026-10-27T15:01:00Z')
      expect(quote()).toMatchObject({ lastPrice: 132, previousClose: 129, change: 3 })
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
        expect(quote()).toEqual(completedSnapshot)
        trade(125, '2026-10-27T19:59:59.999Z')
        expect(quote()).toEqual(completedSnapshot)
      }
      const correctedSnapshot = createMarketQuoteSnapshot({ ...completedSnapshot, lastPrice: 131 })
      buildMarketQuoteSnapshotMock.mockResolvedValue(correctedSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toEqual(correctedSnapshot)
      expect(executeProviderRequestMock).not.toHaveBeenCalled()
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
      const quote = () =>
        socket.emit.mock.calls.findLast(
          ([event]: [string]) => event === 'market-quote-snapshot'
        )?.[1].snapshot
      expect(quote()).toEqual(inferred)
      if (partial) {
        buildMarketQuoteSnapshotMock.mockResolvedValue(
          createMarketQuoteSnapshot({
            ...corrected,
            lastPrice: 124,
            lastPriceEndTime: '2026-10-26T19:59:30Z',
          })
        )
        await vi.advanceTimersByTimeAsync(60_000)
        expect(quote()).toEqual(createMarketQuoteSnapshot({ ...corrected, lastPrice: 130 }))
      }
      buildMarketQuoteSnapshotMock.mockResolvedValue(corrected)
      for (let refresh = 0; refresh < 2; refresh++) {
        await vi.advanceTimersByTimeAsync(60_000)
        expect(quote()).toEqual(corrected)
      }
      expect(quote().change).toBe(11)
      expect(inferred.lastPriceEndTime).toBe('2026-10-27T04:00:00Z')
      manager.removeSocket(socket.id)
    }
  )

  it.each(['alpaca', 'finnhub'])(
    'keeps %s live prices before seeding and through historical failures',
    async (provider) => {
      vi.useFakeTimers()
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
      const quote = () =>
        socket.emit.mock.calls
          .filter(([event]: [string]) => event === 'market-quote-snapshot')
          .at(-1)![1].snapshot
      const trade = (price: number, timeStamp: string) =>
        stream.handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      trade(123.45, '2026-10-26T15:01:00Z')
      expect(quote()).toMatchObject({ lastPrice: 123.45, previousClose: null, change: null })
      rejectSeed(new Error('Historical access denied'))
      await vi.advanceTimersByTimeAsync(0)
      expect(quote()).toMatchObject({ lastPrice: 123.45, error: 'Historical access denied' })
      trade(126, '2026-10-26T15:02:00Z')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({
        lastPrice: 126,
        previousClose: null,
        change: null,
        error: 'Historical access denied',
      })
      buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({ lastPrice: 126, previousClose: 120, change: 6 })
      expect(quote().error).toBeUndefined()
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
      const quote = () =>
        socket.emit.mock.calls
          .filter(([event]: [string]) => event === 'market-quote-snapshot')
          .at(-1)![1].snapshot
      const trade = (price: number, timeStamp: string) =>
        finnhubStreamInstances[0].handlers.onTrade({ symbol: 'AAPL', trade: { price, timeStamp } })
      trade(1.09, '2026-10-26T23:59:00Z')
      expect(quote().lastPrice).toBe(1.08)
      expect(quote().change).toBeCloseTo(0.01)
      expect(quote().volumeUsd).toBeCloseTo(108)
      trade(1.1, '2026-10-27T00:00:00Z')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(quote()).toMatchObject({
        lastPrice: 1.1,
        previousClose: null,
        change: null,
        timezone: 'UTC',
      })
      expect(quote().volumeUsd).toBeUndefined()
      expect(quote().lastPriceEndTime).toBeUndefined()
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
      expect(quote().previousClose).toBe(1.09)
      expect(quote().change).toBeCloseTo(0.01)
      trade(1.11, '2026-10-27T00:01:00Z')
      expect(quote().lastPrice).toBe(1.11)
      expect(quote().change).toBeCloseTo(0.02)
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

  it.each([26, 30])('refreshes %s native quote symbols once per minute', async (count) => {
    vi.useFakeTimers()
    const manager = new MarketStreamManager()
    const socket = createSocket('watchlist')
    buildMarketQuoteSnapshotMock.mockResolvedValue(regularSnapshot)
    for (let index = 0; index < count; index++) {
      resolveProviderSymbolMock.mockReturnValueOnce(`SYMBOL${index}`)
      await manager.subscribe(socket, {
        ...nativeQuotePayload('alpaca'),
        listing: { ...listing, listing_id: `listing-${index}` },
        clientSubscriptionId: `quote-${index}`,
      })
      await vi.advanceTimersByTimeAsync(0)
    }
    resolveProviderSymbolMock.mockReturnValueOnce('SYMBOL0')
    await manager.subscribe(socket, {
      ...nativeQuotePayload('alpaca'),
      listing: { ...listing, listing_id: 'listing-0' },
      clientSubscriptionId: 'duplicate',
    })
    alpacaStreamInstances[0].handlers.onTrade({
      symbol: 'SYMBOL0',
      trade: { price: 126, timeStamp: '2026-10-26T15:01:00Z' },
    })
    await vi.advanceTimersByTimeAsync(59_999)
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(count)
    await vi.advanceTimersByTimeAsync(1)
    expect(buildMarketQuoteSnapshotMock).toHaveBeenCalledTimes(count * 2)
    manager.removeSocket(socket.id)
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

  it('reuses fresh quotes and refreshes staggered symbols at their own deadlines', async () => {
    vi.useFakeTimers()
    getMarketProviderPollingIntervalMsMock.mockReturnValue(15_000)
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
