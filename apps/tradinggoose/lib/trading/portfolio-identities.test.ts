/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: [] as Array<{ id: string; providerId: string }>,
  getOAuthTokenByCredentialId: vi.fn(),
  listPortfolioIdentities: vi.fn(),
}))

vi.mock('@tradinggoose/db', () => ({
  db: {
    select: vi.fn(() => {
      const chain = {
        from: vi.fn(() => chain),
        where: vi.fn(() => Promise.resolve(mocks.credentials)),
      }
      return chain
    }),
  },
}))

vi.mock('@tradinggoose/db/schema', () => ({
  account: {
    id: 'account.id',
    providerId: 'account.providerId',
    userId: 'account.userId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  getOAuthTokenByCredentialId: (...args: unknown[]) => mocks.getOAuthTokenByCredentialId(...args),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  listPortfolioIdentities: (...args: unknown[]) => mocks.listPortfolioIdentities(...args),
}))

vi.mock('@/providers/trading/providers', () => ({
  getTradingProviderDefinition: vi.fn(() => ({
    oauth: {
      credentialServices: [
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
  credentialId: 'credential-live',
  credentialServiceId: 'alpaca-live',
  accountId: 'account-1',
}

describe('listUserTradingPortfolioIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials = []
    mocks.getOAuthTokenByCredentialId.mockResolvedValue('token')
    mocks.listPortfolioIdentities.mockResolvedValue([portfolioIdentity])
  })

  it('throws for a selected credential service when any same-service account load fails', async () => {
    mocks.credentials = [
      { id: 'credential-live', providerId: 'alpaca-live' },
      { id: 'credential-stale', providerId: 'alpaca-live' },
    ]
    mocks.getOAuthTokenByCredentialId.mockImplementation(
      ({ credentialId }: { credentialId: string }) =>
        credentialId === 'credential-stale' ? null : 'token'
    )
    const { listUserTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listUserTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        credentialServiceId: 'alpaca-live',
        requestId: 'request-1',
      })
    ).rejects.toThrow('Failed to load trading portfolio identities')
  })

  it('returns healthy identities when another credential service fails during all-service loading', async () => {
    mocks.credentials = [
      { id: 'credential-live', providerId: 'alpaca-live' },
      { id: 'credential-paper', providerId: 'alpaca-paper' },
    ]
    mocks.getOAuthTokenByCredentialId.mockImplementation(
      ({ credentialId }: { credentialId: string }) =>
        credentialId === 'credential-paper' ? null : 'token'
    )
    const { listUserTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listUserTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        requestId: 'request-1',
      })
    ).resolves.toEqual([portfolioIdentity])
  })
})
