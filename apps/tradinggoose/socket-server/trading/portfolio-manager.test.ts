/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  refreshAccessTokenIfNeededMock,
  getTradingProviderDefinitionMock,
  getTradingProviderOAuthEnvironmentMock,
  getTradingProviderOAuthServiceIdMock,
  getTradingPortfolioSupportedWindowsMock,
  isTradingPortfolioWindowSupportedMock,
  resolveOAuthConnectionAccountForUserMock,
  checkWorkspaceAccessMock,
  listTradingPortfolioIdentitiesMock,
  getPortfolioDetailMock,
  getTradingAccountPerformanceMock,
} = vi.hoisted(() => ({
  refreshAccessTokenIfNeededMock: vi.fn(),
  getTradingProviderDefinitionMock: vi.fn(),
  getTradingProviderOAuthServiceIdMock: vi.fn(),
  getTradingProviderOAuthEnvironmentMock: vi.fn(),
  getTradingPortfolioSupportedWindowsMock: vi.fn(),
  isTradingPortfolioWindowSupportedMock: vi.fn(),
  resolveOAuthConnectionAccountForUserMock: vi.fn(),
  checkWorkspaceAccessMock: vi.fn(),
  listTradingPortfolioIdentitiesMock: vi.fn(),
  getPortfolioDetailMock: vi.fn(),
  getTradingAccountPerformanceMock: vi.fn(),
}))
vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: (...args: unknown[]) => refreshAccessTokenIfNeededMock(...args),
}))
vi.mock('@/lib/credentials/oauth', () => ({
  resolveOAuthConnectionAccountForUser: (...args: unknown[]) =>
    resolveOAuthConnectionAccountForUserMock(...args),
}))
vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: (...args: unknown[]) => checkWorkspaceAccessMock(...args),
}))
vi.mock('@/lib/trading/portfolio-identities', () => ({
  listTradingPortfolioIdentities: (...args: unknown[]) =>
    listTradingPortfolioIdentitiesMock(...args),
}))
vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))
vi.mock('@/providers/trading/portfolio', () => ({
  getPortfolioDetail: (...args: unknown[]) => getPortfolioDetailMock(...args),
  getTradingAccountPerformance: (...args: unknown[]) => getTradingAccountPerformanceMock(...args),
  getTradingPortfolioSupportedWindows: (...args: unknown[]) =>
    getTradingPortfolioSupportedWindowsMock(...args),
  isTradingPortfolioWindowSupported: (...args: unknown[]) =>
    isTradingPortfolioWindowSupportedMock(...args),
}))
vi.mock('@/providers/trading/providers', () => ({
  getTradingProviderDefinition: (...args: unknown[]) => getTradingProviderDefinitionMock(...args),
  getTradingProviderOAuthEnvironment: (...args: unknown[]) =>
    getTradingProviderOAuthEnvironmentMock(...args),
  getTradingProviderOAuthServiceId: (...args: unknown[]) =>
    getTradingProviderOAuthServiceIdMock(...args),
}))

import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import { TradingPortfolioStreamManager } from './portfolio-manager'

const portfolioIdentity: PortfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'oauth-credential-1',
  serviceId: 'alpaca-live',
  accountId: 'acct-1',
  providerName: 'Alpaca',
  accountName: 'Primary',
  accountType: 'paper',
  baseCurrency: 'USD',
  accountStatus: 'active',
}
const portfolioDetail = {
  ...portfolioIdentity,
  environment: 'live',
  asOf: '2026-04-30T12:00:00.000Z',
  cashBalances: [],
  positions: [
    {
      listingIdentity: {
        listing_id: 'TG_LSTG_AAPL',
        base_id: '',
        quote_id: '',
        listing_type: 'default',
      },
      quantity: 2,
    },
  ],
  orders: [],
  summary: {
    totalPortfolioValue: 1000,
    totalCashValue: 100,
  },
}
const snapshotSubscription = {
  workspaceId: 'workspace-1',
  provider: 'alpaca',
  serviceId: 'alpaca-live',
  portfolioIdentity,
  channel: 'account-snapshot',
} as const
const performance = {
  window: '1D' as const,
  supportedWindows: ['1D' as const],
  series: [{ timestamp: '2026-04-30T12:00:00.000Z', equity: 1000 }],
  summary: {
    currency: 'USD',
    startEquity: 900,
    endEquity: 1000,
    highEquity: 1000,
    lowEquity: 900,
    absoluteReturn: 100,
    percentReturn: 11.11,
    asOf: '2026-04-30T12:00:00.000Z',
  },
}
const createSocket = (id: string) =>
  ({
    id,
    userId: 'user-1',
    emit: vi.fn(),
  }) as any
const flushPortfolioPolls = async () => {
  for (let index = 0; index < 32; index += 1) {
    await Promise.resolve()
  }
}
const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
describe('TradingPortfolioStreamManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveOAuthConnectionAccountForUserMock.mockResolvedValue({
      tokenAccountId: 'oauth-credential-1',
      credentialOwnerUserId: 'user-1',
      providerId: 'alpaca-live',
    })
    checkWorkspaceAccessMock.mockResolvedValue({
      exists: true,
      hasAccess: true,
    })
    refreshAccessTokenIfNeededMock.mockResolvedValue('oauth-token')
    getTradingProviderDefinitionMock.mockReturnValue({
      id: 'alpaca',
      name: 'Alpaca',
    })
    getTradingProviderOAuthServiceIdMock.mockReturnValue('alpaca-live')
    getTradingProviderOAuthEnvironmentMock.mockReturnValue('live')
    getTradingPortfolioSupportedWindowsMock.mockReturnValue(['1D', '1W'])
    isTradingPortfolioWindowSupportedMock.mockReturnValue(true)
    listTradingPortfolioIdentitiesMock.mockResolvedValue([portfolioIdentity])
    getPortfolioDetailMock.mockResolvedValue(portfolioDetail)
    getTradingAccountPerformanceMock.mockResolvedValue(performance)
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('shares one snapshot poll for duplicate portfolio snapshot subscribers', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')
    const first = await manager.subscribe(firstSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-1',
    })
    const duplicate = await manager.subscribe(firstSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(secondSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-2',
    })
    expect(first.subscriptionId).not.toBe(duplicate.subscriptionId)
    expect((manager as unknown as { streams: Map<string, unknown> }).streams.size).toBe(1)
    await flushPortfolioPolls()
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(1)
    expect(listTradingPortfolioIdentitiesMock).toHaveBeenCalledTimes(1)
    expect(listTradingPortfolioIdentitiesMock).toHaveBeenCalledWith({
      userId: 'user-1',
      providerId: 'alpaca',
      serviceId: 'alpaca-live',
      credentialId: 'oauth-credential-1',
      requestId: expect.any(String),
    })
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'alpaca',
      credentialId: 'oauth-credential-1',
      tokenAccountId: 'oauth-credential-1',
      serviceId: 'alpaca-live',
      environment: 'live',
      accessToken: 'oauth-token',
      accountId: 'acct-1',
    })
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({
        provider: 'alpaca',
        serviceId: 'alpaca-live',
        channel: 'account-snapshot',
        portfolioIdentity,
        portfolioDetail: expect.objectContaining({ accountId: 'acct-1' }),
        subscriptionId: expect.any(String),
        clientSubscriptionId: 'snapshot-1',
      })
    )
    expect(secondSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({
        clientSubscriptionId: 'snapshot-2',
      })
    )
    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
  })
  it('supports exact and client-scoped socket unsubscription', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')
    const first = await manager.subscribe(socket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'portfolio_snapshot',
    })
    const second = await manager.subscribe(socket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'portfolio_snapshot',
    })
    expect(manager.unsubscribe(socket, { subscriptionId: first.subscriptionId })).toEqual([first])
    expect(manager.unsubscribe(socket, { clientSubscriptionId: 'portfolio_snapshot' })).toEqual([
      second,
    ])
  })
  it('keeps identical data subscriptions independently owned', () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const subscribe = () =>
      manager.subscribeData({
        ...snapshotSubscription,
        userId: 'user-1',
        clientSubscriptionId: 'portfolio-monitor',
        onData: vi.fn(),
      })
    const first = subscribe()
    const second = subscribe()
    const streams = (manager as any).streams as Map<string, { subscribers: Map<string, unknown> }>
    const stream = Array.from(streams.values())[0]
    expect(stream.subscribers.size).toBe(2)
    first.unsubscribe()
    expect(stream.subscribers.size).toBe(1)
    second.unsubscribe()
    expect(streams.size).toBe(0)
  })
  it('dedupes account pulls across snapshot and performance streams for the same portfolio', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')
    await manager.subscribe(socket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(socket, {
      ...snapshotSubscription,
      channel: 'portfolio-performance',
      window: '1D',
      clientSubscriptionId: 'performance-1',
    })
    await flushPortfolioPolls()
    expect(listTradingPortfolioIdentitiesMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(1)
    expect(getTradingAccountPerformanceMock).toHaveBeenCalledTimes(1)
    expect(socket.emit).toHaveBeenCalledWith(
      'trading-portfolio-performance',
      expect.objectContaining({
        provider: 'alpaca',
        serviceId: 'alpaca-live',
        channel: 'portfolio-performance',
        portfolioIdentity,
        window: '1D',
        performance,
      })
    )
    manager.removeSocket(socket.id)
  })
  it('stops portfolio polling without waiting for socket disconnect', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')
    await manager.subscribe(socket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-1',
    })
    await flushPortfolioPolls()
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(1)
    manager.stop()
    await expect(
      manager.subscribe(socket, {
        ...snapshotSubscription,
        clientSubscriptionId: 'snapshot-2',
      })
    ).rejects.toThrow('Trading portfolio stream manager is stopped')
    await vi.advanceTimersByTimeAsync(30_000)
    await flushPortfolioPolls()
    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(1)
  })
  it('coalesces forced refreshes while keeping correlation scoped to each subscriber', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')
    const observingSocket = createSocket('socket-3')
    const initialPoll = createDeferred<typeof portfolioDetail>()
    const successorPortfolioDetail = {
      ...portfolioDetail,
      summary: { ...portfolioDetail.summary, totalPortfolioValue: 2000 },
    }
    getPortfolioDetailMock
      .mockReturnValueOnce(initialPoll.promise)
      .mockResolvedValue(successorPortfolioDetail)
    await manager.subscribe(firstSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(secondSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-2',
    })
    await manager.subscribe(observingSocket, {
      ...snapshotSubscription,
      clientSubscriptionId: 'snapshot-3',
    })
    manager.refresh(firstSocket, {
      clientSubscriptionId: 'snapshot-1',
      refreshId: 'refresh-1',
    })
    expect(() =>
      manager.refresh(firstSocket, {
        clientSubscriptionId: 'snapshot-1',
        refreshId: 'refresh-1',
      })
    ).not.toThrow()
    expect(() =>
      manager.refresh(firstSocket, {
        clientSubscriptionId: 'snapshot-1',
        refreshId: 'refresh-replaced',
      })
    ).toThrow('Trading portfolio refresh already pending')
    manager.refresh(secondSocket, {
      clientSubscriptionId: 'snapshot-2',
      refreshId: 'refresh-2',
    })
    initialPoll.resolve(portfolioDetail)
    await flushPortfolioPolls()
    await flushPortfolioPolls()
    const firstSnapshots = firstSocket.emit.mock.calls
      .filter(([event]: [string]) => event === 'trading-portfolio-snapshot')
      .map(([, payload]: [string, Record<string, unknown>]) => payload)
    const secondSnapshots = secondSocket.emit.mock.calls
      .filter(([event]: [string]) => event === 'trading-portfolio-snapshot')
      .map(([, payload]: [string, Record<string, unknown>]) => payload)
    const observingSnapshots = observingSocket.emit.mock.calls
      .filter(([event]: [string]) => event === 'trading-portfolio-snapshot')
      .map(([, payload]: [string, Record<string, unknown>]) => payload)
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(2)
    expect(
      [firstSnapshots, secondSnapshots, observingSnapshots].map((snapshots) =>
        snapshots.map((payload: Record<string, unknown>) => payload.refreshId)
      )
    ).toEqual([
      [undefined, 'refresh-1'],
      [undefined, 'refresh-2'],
      [undefined, undefined],
    ])
    expect(
      [firstSnapshots, secondSnapshots, observingSnapshots].map((snapshots) =>
        snapshots.map((payload: any) => payload.portfolioDetail.summary.totalPortfolioValue)
      )
    ).toEqual([
      [1000, 2000],
      [1000, 2000],
      [1000, 2000],
    ])
    const periodicPoll = createDeferred<typeof portfolioDetail>()
    getPortfolioDetailMock
      .mockReturnValueOnce(periodicPoll.promise)
      .mockRejectedValueOnce(new Error('Forced refresh failed'))
    await vi.advanceTimersByTimeAsync(15_000)
    manager.refresh(firstSocket, {
      clientSubscriptionId: 'snapshot-1',
      refreshId: 'refresh-error-1',
    })
    manager.refresh(secondSocket, {
      clientSubscriptionId: 'snapshot-2',
      refreshId: 'refresh-error-2',
    })
    periodicPoll.resolve(portfolioDetail)
    await flushPortfolioPolls()
    await flushPortfolioPolls()
    for (const [socket, clientSubscriptionId, refreshId] of [
      [firstSocket, 'snapshot-1', 'refresh-error-1'],
      [secondSocket, 'snapshot-2', 'refresh-error-2'],
    ] as const) {
      expect(socket.emit).toHaveBeenCalledWith(
        'trading-portfolio-error',
        expect.objectContaining({
          clientSubscriptionId,
          refreshId,
          message: 'Forced refresh failed',
        })
      )
    }
    expect(observingSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-error',
      expect.not.objectContaining({ refreshId: expect.anything() })
    )
    const cleanupPoll = createDeferred<typeof portfolioDetail>()
    getPortfolioDetailMock.mockReturnValueOnce(cleanupPoll.promise)
    await vi.advanceTimersByTimeAsync(15_000)
    manager.refresh(observingSocket, {
      clientSubscriptionId: 'snapshot-3',
      refreshId: 'removed-refresh',
    })
    manager.removeSocket(observingSocket.id)
    cleanupPoll.resolve(portfolioDetail)
    await flushPortfolioPolls()
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(5)
    const stalledPoll = createDeferred<typeof portfolioDetail>()
    getPortfolioDetailMock
      .mockReturnValueOnce(stalledPoll.promise)
      .mockResolvedValueOnce(successorPortfolioDetail)
    await vi.advanceTimersByTimeAsync(15_000)
    manager.refresh(firstSocket, {
      clientSubscriptionId: 'snapshot-1',
      refreshId: 'refresh-after-timeout',
    })
    await vi.advanceTimersByTimeAsync(20_000)
    await flushPortfolioPolls()
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-error',
      expect.objectContaining({
        message: 'Trading portfolio refresh timed out',
      })
    )
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({ refreshId: 'refresh-after-timeout' })
    )
    stalledPoll.resolve(portfolioDetail)
    await flushPortfolioPolls()
    expect(() =>
      manager.refresh(firstSocket, {
        clientSubscriptionId: 'missing',
        refreshId: 'missing-refresh',
      })
    ).toThrow('Trading portfolio subscription not found')
    manager.stop()
  })
})
