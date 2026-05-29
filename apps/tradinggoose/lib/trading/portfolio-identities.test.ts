/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  connections: [] as Array<{
    tokenAccountId: string
    providerId: string
    credentialOwnerUserId: string
  }>,
  connectionById: new Map<
    string,
    {
      tokenAccountId: string
      providerId: string
      credentialOwnerUserId: string
    }
  >(),
  refreshAccessTokenIfNeeded: vi.fn(),
  listPortfolioIdentities: vi.fn(),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: (...args: unknown[]) => mocks.refreshAccessTokenIfNeeded(...args),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  listOAuthConnectionAccountsForUser: vi.fn(() => Promise.resolve(mocks.connections)),
  resolveOAuthConnectionAccountForUser: vi.fn(({ accountId }: { accountId: string }) =>
    Promise.resolve(mocks.connectionById.get(accountId) ?? null)
  ),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  listPortfolioIdentities: (...args: unknown[]) => mocks.listPortfolioIdentities(...args),
}))

vi.mock('@/providers/trading/providers', () => ({
  getTradingProviderDefinition: vi.fn(() => ({
    oauth: {
      services: [
        { serviceId: 'alpaca-live', environment: 'live' },
        { serviceId: 'alpaca-paper', environment: 'paper' },
      ],
    },
  })),
  getTradingProviderOAuthEnvironment: vi.fn((_providerId: string, serviceId: string) =>
    serviceId === 'alpaca-paper' ? 'paper' : 'live'
  ),
  getTradingProviderOAuthServiceId: vi.fn((_providerId: string, serviceId?: string) =>
    serviceId === 'alpaca-live' || serviceId === 'alpaca-paper' ? serviceId : undefined
  ),
}))

const portfolioIdentity = {
  providerId: 'alpaca',
  credentialId: 'connection-live',
  serviceId: 'alpaca-live',
  accountId: 'account-1',
}

describe('listTradingPortfolioIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.connections = []
    mocks.connectionById = new Map()
    mocks.refreshAccessTokenIfNeeded.mockResolvedValue('token')
    mocks.listPortfolioIdentities.mockResolvedValue([portfolioIdentity])
  })

  it('throws when no selected connection identities can be resolved', async () => {
    mocks.connectionById.set('connection-stale', {
      tokenAccountId: 'connection-stale',
      providerId: 'alpaca-live',
      credentialOwnerUserId: 'user-1',
    })
    mocks.refreshAccessTokenIfNeeded.mockImplementation((tokenAccountId: string) =>
      tokenAccountId === 'connection-stale' ? null : 'token'
    )
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        serviceId: 'alpaca-live',
        credentialId: 'connection-stale',
        requestId: 'request-1',
      })
    ).rejects.toThrow('Trading connection token unavailable: connection-stale')
  })

  it('returns identities from healthy connections when another connection fails', async () => {
    mocks.connections = [
      {
        tokenAccountId: 'connection-live',
        providerId: 'alpaca-live',
        credentialOwnerUserId: 'user-1',
      },
      {
        tokenAccountId: 'connection-paper',
        providerId: 'alpaca-paper',
        credentialOwnerUserId: 'user-1',
      },
    ]
    mocks.refreshAccessTokenIfNeeded.mockImplementation((tokenAccountId: string) =>
      tokenAccountId === 'connection-paper' ? null : 'token'
    )
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        requestId: 'request-1',
      })
    ).resolves.toEqual([portfolioIdentity])
  })

  it('returns identities for all owned trading connections', async () => {
    mocks.connections = [
      {
        tokenAccountId: 'connection-live',
        providerId: 'alpaca-live',
        credentialOwnerUserId: 'user-1',
      },
    ]
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        requestId: 'request-1',
      })
    ).resolves.toEqual([portfolioIdentity])
  })
})
