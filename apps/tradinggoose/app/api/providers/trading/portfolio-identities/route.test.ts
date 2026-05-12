/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  listPortfolioIdentities: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getSession: (...args: unknown[]) => mocks.getSession(...args),
}))

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: vi.fn(() => ({ warn: vi.fn() })),
}))

vi.mock('@/lib/oauth', () => ({
  getServiceByProviderAndId: vi.fn((_providerId: string, serviceId: string) => ({
    name: serviceId === 'alpaca-live' ? 'Alpaca Live' : serviceId,
  })),
}))

vi.mock('@/lib/trading/portfolio-identities', () => ({
  listUserTradingPortfolioIdentities: (...args: unknown[]) =>
    mocks.listPortfolioIdentities(...args),
}))

vi.mock('@/lib/utils', () => ({
  generateRequestId: vi.fn(() => 'request-1'),
}))

vi.mock('@/providers/trading/providers', () => ({
  getTradingProviderDefinition: vi.fn((providerId: string) =>
    providerId === 'alpaca'
      ? {
          oauth: {
            credentialServices: [{ serviceId: 'alpaca-live' }],
          },
        }
      : null
  ),
}))

describe('trading portfolio identities route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue({ user: { id: 'user-1' } })
  })

  it('returns a load failure instead of an empty account list when account loading fails', async () => {
    mocks.listPortfolioIdentities.mockRejectedValue(new Error('provider unavailable'))
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/providers/trading/portfolio-identities?provider=alpaca')
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to load trading accounts' })
  })

  it('returns portfolio identity options when account loading succeeds', async () => {
    mocks.listPortfolioIdentities.mockResolvedValue([
      {
        providerId: 'alpaca',
        providerName: 'Alpaca',
        credentialId: 'credential-1',
        credentialServiceId: 'alpaca-live',
        accountId: 'account-1',
        accountName: 'Main',
        accountType: 'cash',
        accountStatus: 'active',
        baseCurrency: 'USD',
      },
    ])
    const { GET } = await import('./route')

    const response = await GET(
      new Request('http://localhost/api/providers/trading/portfolio-identities?provider=alpaca')
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      options: [
        {
          label: 'Main',
          rightLabel: 'Alpaca Live - cash - active - USD',
          value: {
            credentialId: 'credential-1',
            accountId: 'account-1',
          },
        },
      ],
    })
  })
})
