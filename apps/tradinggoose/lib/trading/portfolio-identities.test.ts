/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  credentials: [] as Array<{ id: string; providerId: string; userId: string }>,
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
  permissions: {
    entityId: 'permissions.entityId',
    entityType: 'permissions.entityType',
    userId: 'permissions.userId',
  },
  workflow: {
    id: 'workflow.id',
    workspaceId: 'workflow.workspaceId',
  },
  workspace: {
    id: 'workspace.id',
    ownerId: 'workspace.ownerId',
  },
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNotNull: vi.fn(),
  or: vi.fn(),
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: vi.fn(() => Promise.resolve({ hasAccess: true, canWrite: true })),
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
    mocks.getOAuthTokenByCredentialId.mockResolvedValue('token')
    mocks.listPortfolioIdentities.mockResolvedValue([portfolioIdentity])
  })

  it('throws for a selected service when any same-service account load fails', async () => {
    mocks.credentials = [
      { id: 'credential-live', providerId: 'alpaca-live', userId: 'user-1' },
      { id: 'credential-stale', providerId: 'alpaca-live', userId: 'user-1' },
    ]
    mocks.getOAuthTokenByCredentialId.mockImplementation(
      ({ credentialId }: { credentialId: string }) =>
        credentialId === 'credential-stale' ? null : 'token'
    )
    const { listTradingPortfolioIdentities } = await import('./portfolio-identities')

    await expect(
      listTradingPortfolioIdentities({
        userId: 'user-1',
        providerId: 'alpaca',
        serviceId: 'alpaca-live',
        requestId: 'request-1',
      })
    ).rejects.toThrow('Failed to load trading portfolio identities')
  })

  it('returns healthy identities when another service fails during all-service loading', async () => {
    mocks.credentials = [
      { id: 'credential-live', providerId: 'alpaca-live', userId: 'user-1' },
      { id: 'credential-paper', providerId: 'alpaca-paper', userId: 'user-1' },
    ]
    mocks.getOAuthTokenByCredentialId.mockImplementation(
      ({ credentialId }: { credentialId: string }) =>
        credentialId === 'credential-paper' ? null : 'token'
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
})
