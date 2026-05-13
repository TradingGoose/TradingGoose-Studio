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
  resolveOAuthCredentialAccountForUserMock,
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
  resolveOAuthCredentialAccountForUserMock: vi.fn(),
  listTradingPortfolioIdentitiesMock: vi.fn(),
  getPortfolioDetailMock: vi.fn(),
  getTradingAccountPerformanceMock: vi.fn(),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: (...args: unknown[]) => refreshAccessTokenIfNeededMock(...args),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  resolveOAuthCredentialAccountForUser: (...args: unknown[]) =>
    resolveOAuthCredentialAccountForUserMock(...args),
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
  credentialId: 'credential-1',
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
      symbol: {
        base: 'AAPL',
        quote: 'USD',
        listing: {
          listing_id: 'TG_LSTG_AAPL',
          base_id: '',
          quote_id: '',
          listing_type: 'default',
        },
        assetClass: 'stock' as const,
        active: true,
        rank: 0,
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
    resolveOAuthCredentialAccountForUserMock.mockResolvedValue({
      accountId: 'account-credential-1',
      credentialOwnerUserId: 'user-1',
      providerId: 'alpaca-live',
      workspaceId: 'workspace-1',
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

    await manager.subscribe(firstSocket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(secondSocket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-2',
    })

    await flushPortfolioPolls()

    expect(refreshAccessTokenIfNeededMock).toHaveBeenCalledTimes(1)
    expect(listTradingPortfolioIdentitiesMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledTimes(1)
    expect(getPortfolioDetailMock).toHaveBeenCalledWith({
      providerId: 'alpaca',
      credentialId: 'credential-1',
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
        workspaceId: 'workspace-1',
        channel: 'account-snapshot',
        portfolioIdentity,
        portfolioDetail: expect.objectContaining({ accountId: 'acct-1' }),
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

  it('keeps duplicate client subscription ids isolated across sockets', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const firstSocket = createSocket('socket-1')
    const secondSocket = createSocket('socket-2')

    const first = await manager.subscribe(firstSocket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'portfolio_snapshot',
    })
    const second = await manager.subscribe(secondSocket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'portfolio_snapshot',
    })

    expect(first.subscriptionId).not.toBe(second.subscriptionId)

    await flushPortfolioPolls()

    expect(firstSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({
        subscriptionId: first.subscriptionId,
        clientSubscriptionId: 'portfolio_snapshot',
      })
    )
    expect(secondSocket.emit).toHaveBeenCalledWith(
      'trading-portfolio-snapshot',
      expect.objectContaining({
        subscriptionId: second.subscriptionId,
        clientSubscriptionId: 'portfolio_snapshot',
      })
    )

    manager.removeSocket(firstSocket.id)
    manager.removeSocket(secondSocket.id)
  })

  it('dedupes account pulls across snapshot and performance streams for the same portfolio', async () => {
    vi.useFakeTimers()
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')

    await manager.subscribe(socket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
      channel: 'account-snapshot',
      clientSubscriptionId: 'snapshot-1',
    })
    await manager.subscribe(socket, {
      provider: 'alpaca',
      serviceId: 'alpaca-live',
      portfolioIdentity,
      workspaceId: 'workspace-1',
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
        workspaceId: 'workspace-1',
        channel: 'portfolio-performance',
        portfolioIdentity,
        window: '1D',
        performance,
      })
    )

    manager.removeSocket(socket.id)
  })

  it('requires workspace scope before broker calls', async () => {
    const manager = new TradingPortfolioStreamManager()
    const socket = createSocket('socket-1')

    await expect(
      manager.subscribe(socket, {
        provider: 'alpaca',
        serviceId: 'alpaca-live',
        portfolioIdentity,
        channel: 'account-snapshot',
      })
    ).rejects.toThrow('workspaceId is required')

    expect(refreshAccessTokenIfNeededMock).not.toHaveBeenCalled()
    expect(getPortfolioDetailMock).not.toHaveBeenCalled()
  })
})
