/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: [] as Array<{
    id: string
    provider: string
  }>,
  credentialAccessById: new Map<
    string,
    {
      credentialId: string
      accountId: string
      providerId: string
      credentialOwnerUserId: string
      workspaceId: string
    }
  >(),
  refreshAccessTokenIfNeeded: vi.fn(),
  listPortfolioIdentities: vi.fn(),
}))

vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: (...args: unknown[]) => mocks.refreshAccessTokenIfNeeded(...args),
}))

vi.mock('@/lib/credentials/oauth', () => ({
  listOAuthCredentialsForUser: vi.fn(() => Promise.resolve(mocks.credentials)),
  resolveOAuthCredentialAccountForUser: vi.fn(({ credentialId }: { credentialId: string }) =>
    Promise.resolve(mocks.credentialAccessById.get(credentialId) ?? null)
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
  credentialId: 'credential-live',
  serviceId: 'alpaca-live',
  accountId: 'account-1',
}

describe('listTradingPortfolioIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.credentials = []
    mocks.credentialAccessById = new Map()
    mocks.refreshAccessTokenIfNeeded.mockResolvedValue('token')
    mocks.listPortfolioIdentities.mockResolvedValue([portfolioIdentity])
  })

  it('throws when no credential identities can be resolved', async () => {
    mocks.credentials = [
      {
        id: 'credential-stale',
        provider: 'alpaca-live',
      },
    ]
    mocks.credentialAccessById.set('credential-stale', {
      credentialId: 'credential-stale',
      accountId: 'account-stale',
      providerId: 'alpaca-live',
      credentialOwnerUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.refreshAccessTokenIfNeeded.mockImplementation((tokenAccountId: string) =>
      tokenAccountId === 'account-stale' ? null : 'token'
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
    ).rejects.toThrow('Trading credential token unavailable: credential-stale')
  })

  it('returns identities from healthy credentials when another credential fails', async () => {
    mocks.credentials = [
      {
        id: 'credential-live',
        provider: 'alpaca-live',
      },
      {
        id: 'credential-paper',
        provider: 'alpaca-paper',
      },
    ]
    mocks.credentialAccessById.set('credential-live', {
      credentialId: 'credential-live',
      accountId: 'account-live',
      providerId: 'alpaca-live',
      credentialOwnerUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.credentialAccessById.set('credential-paper', {
      credentialId: 'credential-paper',
      accountId: 'account-paper',
      providerId: 'alpaca-paper',
      credentialOwnerUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
    mocks.refreshAccessTokenIfNeeded.mockImplementation((tokenAccountId: string) =>
      tokenAccountId === 'account-paper' ? null : 'token'
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

  it('returns identities for all owned trading credentials', async () => {
    mocks.credentials = [
      {
        id: 'credential-live',
        provider: 'alpaca-live',
      },
    ]
    mocks.credentialAccessById.set('credential-live', {
      credentialId: 'credential-live',
      accountId: 'account-live',
      providerId: 'alpaca-live',
      credentialOwnerUserId: 'user-1',
      workspaceId: 'workspace-1',
    })
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
