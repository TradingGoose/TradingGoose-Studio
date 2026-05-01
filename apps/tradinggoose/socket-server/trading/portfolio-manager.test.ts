/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getOAuthTokenMock,
  getTradingProviderDefinitionMock,
  getTradingProviderOAuthEnvironmentMock,
  getTradingProviderOAuthServiceIdMock,
  getTradingPortfolioSupportedWindowsMock,
  isTradingPortfolioWindowSupportedMock,
  listTradingAccountsMock,
  getTradingAccountSnapshotMock,
  getTradingAccountPerformanceMock,
  resolveTradingPositionListingIdentityMock,
} = vi.hoisted(() => ({
  getOAuthTokenMock: vi.fn(),
  getTradingProviderDefinitionMock: vi.fn(),
  getTradingProviderOAuthServiceIdMock: vi.fn(),
  getTradingProviderOAuthEnvironmentMock: vi.fn(),
  getTradingPortfolioSupportedWindowsMock: vi.fn(),
  isTradingPortfolioWindowSupportedMock: vi.fn(),
  listTradingAccountsMock: vi.fn(),
  getTradingAccountSnapshotMock: vi.fn(),
  getTradingAccountPerformanceMock: vi.fn(),
  resolveTradingPositionListingIdentityMock: vi.fn(),
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getOAuthToken: (...args: unknown[]) => getOAuthTokenMock(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('@/providers/trading/listing-resolution', () => ({
  resolveTradingPositionListingIdentity: (...args: unknown[]) =>
    resolveTradingPositionListingIdentityMock(...args),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  getTradingAccountPerformance: (...args: unknown[]) => getTradingAccountPerformanceMock(...args),
  getTradingAccountSnapshot: (...args: unknown[]) => getTradingAccountSnapshotMock(...args),
  getTradingPortfolioSupportedWindows: (...args: unknown[]) =>
    getTradingPortfolioSupportedWindowsMock(...args),
  isTradingPortfolioWindowSupported: (...args: unknown[]) =>
    isTradingPortfolioWindowSupportedMock(...args),
  listTradingAccounts: (...args: unknown[]) => listTradingAccountsMock(...args),
}))

vi.mock('@/providers/trading/providers', () => ({
  getTradingProviderDefinition: (...args: unknown[]) => getTradingProviderDefinitionMock(...args),
  getTradingProviderOAuthEnvironment: (...args: unknown[]) =>
    getTradingProviderOAuthEnvironmentMock(...args),
  getTradingProviderOAuthServiceId: (...args: unknown[]) =>
    getTradingProviderOAuthServiceIdMock(...args),
}))

import { buildTradingPositionListings, TradingPortfolioStreamManager } from './portfolio-manager'

const account = {
  id: 'acct-1',
  name: 'Primary',
  type: 'paper' as const,
  baseCurrency: 'USD',
  status: 'active' as const,
}

const snapshot = {
  asOf: '2026-04-30T12:00:00.000Z',
  provider: { name: 'Alpaca' },
  account: {
    id: 'acct-1',
    name: 'Primary',
    type: 'paper' as const,
    baseCurrency: 'USD',
    status: 'active' as const,
  },
  cashBalances: [],
  positions: [
    {
      symbol: {
        base: 'AAPL',
        quote: 'USD',
        assetClass: 'stock' as const,
        active: true,
        rank: 0,
      },
      quantity: 2,
    },
  ],
  orders: [],
  accountSummary: {
    totalPortfolioValue: 1000,
    totalCashValue: 100,
  },
}

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
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve()
  }
}

describe('TradingPortfolioStreamManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOAuthTokenMock.mockResolvedValue('oauth-token')
    getTradingProviderDefinitionMock.mockReturnValue({
      id: 'alpaca',
      name: 'Alpaca',
    })
    getTradingProviderOAuthServiceIdMock.mockReturnValue('alpaca')
    getTradingProviderOAuthEnvironmentMock.mockReturnValue('live')
    getTradingPortfolioSupportedWindowsMock.mockReturnValue(['1D', '1W'])
    isTradingPortfolioWindowSupportedMock.mockReturnValue(true)
    listTradingAccountsMock.mockResolvedValue([account])
    getTradingAccountSnapshotMock.mockResolvedValue(snapshot)
    getTradingAccountPerformanceMock.mockResolvedValue(performance)
    resolveTradingPositionListingIdentityMock.mockResolvedValue({
      listing_id: 'TG_LSTG_AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shares one snapshot poll for duplicate account snapshot subscribers', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')

    await manager.subscribe(firstSocket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      accountId: 'acct-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(secondSocket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      accountId: 'acct-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-2',
    })

    await flushPortfolioPolls()

    expect(getOAuthTokenMock).toHaveBeenCalledTimes(1)
    expect(listTradingAccountsMock).toHaveBeenCalledTimes(1)
    expect(getTradingAccountSnapshotMock).toHaveBeenCalledTimes(1)
    expect(getTradingAccountSnapshotMock).toHaveBeenCalledWith({
      providerId: 'alpaca',
      environment: 'live',
      accessToken: 'oauth-token',
      accountId: 'acct-1',
    })
    expect(firstSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({
        provider: 'alpaca',
        workspaceId: 'workspace-1',
        channel: 'account-snapshot',
        accountId: 'acct-1',
        clientSubscriptionId: 'snapshot-1',
        snapshot: expect.objectContaining({ account: expect.objectContaining({ id: 'acct-1' }) }),
        positionListings: [
          expect.objectContaining({
            grossQuantity: 2,
            signedQuantity: 2,
          }),
        ],
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

  it('dedupes account pulls across snapshot and performance streams for the same account', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')

    await manager.subscribe(socket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      accountId: 'acct-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(socket, {
      provider: 'alpaca',
      workspaceId: 'workspace-1',
      accountId: 'acct-1',
      channel: 'portfolio-performance',
      window: '1D',
      clientSubscriptionId: 'performance-1',
    })

    await flushPortfolioPolls()

    expect(listTradingAccountsMock).toHaveBeenCalledTimes(1)
    expect(getTradingAccountSnapshotMock).toHaveBeenCalledTimes(1)
    expect(getTradingAccountPerformanceMock).toHaveBeenCalledTimes(1)
    expect(socket.emit).toHaveBeenCalledWith(
      'trading-portfolio-performance',
      expect.objectContaining({
        provider: 'alpaca',
        workspaceId: 'workspace-1',
        channel: 'portfolio-performance',
        accountId: 'acct-1',
        window: '1D',
        performance,
      })
    )

    manager.removeSocket(socket.id)
  })
})

describe('buildTradingPositionListings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveTradingPositionListingIdentityMock.mockImplementation((symbol: { base: string }) => ({
      listing_id: `TG_LSTG_${symbol.base}`,
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    }))
  })

  it('maps widget-local broker positions into canonical listing totals', async () => {
    const listings = await buildTradingPositionListings({
      ...snapshot,
      positions: [
        { ...snapshot.positions[0], quantity: 3, multiplier: 2 },
        { ...snapshot.positions[0], quantity: -1 },
      ],
    })

    expect(listings).toEqual([
      {
        listing: {
          listing_id: 'TG_LSTG_AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        grossQuantity: 7,
        signedQuantity: 5,
      },
    ])
  })
})
