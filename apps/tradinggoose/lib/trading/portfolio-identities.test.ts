/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: [] as Array<{
    credentialId: string
    tokenAccountId: string
    providerId: string
    credentialOwnerUserId: string
  }>,
  refreshAccessTokenIfNeeded: vi.fn(),
  listPortfolioIdentities: vi.fn(),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: (...args: unknown[]) => mocks.refreshAccessTokenIfNeeded(...args),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  listOAuthCredentialAccountsForUser: vi.fn(() => Promise.resolve(mocks.credentials)),
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
  credentialId: 'credential-live',
  serviceId: 'alpaca-live',
  accountId: 'account-1',
}

describe('listTradingPortfolioIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials = []
    mocks.refreshAccessTokenIfNeeded.mockResolvedValue('token')
    mocks.listPortfolioIdentities.mockResolvedValue([portfolioIdentity])
  })

  it('throws for a selected service when any same-service account load fails', async () => {
    mocks.credentials = [
      {
        credentialId: 'credential-live',
        tokenAccountId: 'account-live',
        providerId: 'alpaca-live',
        credentialOwnerUserId: 'user-1',
      },
      {
        credentialId: 'credential-stale',
        tokenAccountId: 'account-stale',
        providerId: 'alpaca-live',
        credentialOwnerUserId: 'user-1',
      },
    ]
    mocks.refreshAccessTokenIfNeeded.mockImplementation((credentialId: string) =>
      credentialId === 'account-stale' ? null : 'token'
    )
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'alpaca',
        serviceId: 'alpaca-live',
        requestId: 'request-1',
      })
    ).rejects.toThrow('Failed to load trading portfolio identities')
  })

  it('returns healthy identities when another service fails during all-service loading', async () => {
    mocks.credentials = [
      {
        credentialId: 'credential-live',
        tokenAccountId: 'account-live',
        providerId: 'alpaca-live',
        credentialOwnerUserId: 'user-1',
      },
      {
        credentialId: 'credential-paper',
        tokenAccountId: 'account-paper',
        providerId: 'alpaca-paper',
        credentialOwnerUserId: 'user-1',
      },
    ]
    mocks.refreshAccessTokenIfNeeded.mockImplementation((credentialId: string) =>
      credentialId === 'account-paper' ? null : 'token'
    )
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        workspaceId: 'workspace-1',
        providerId: 'alpaca',
        requestId: 'request-1',
      })
    ).resolves.toEqual([portfolioIdentity])
  })
})
