/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'

const mockGetSession = vi.fn()
const mockGetCredential = vi.fn()
const mockRefreshAccessTokenIfNeeded = vi.fn()
const mockListTradingAccounts = vi.fn()

vi.mock('@/lib/logs/console/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('@/lib/auth', () => ({
  getSession: mockGetSession,
}))

vi.mock('@/app/api/auth/oauth/utils', () => ({
  getCredential: mockGetCredential,
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

vi.mock('@/providers/trading/portfolio', async () => {
  const actual = await vi.importActual('@/providers/trading/portfolio')
  return {
    ...(actual as object),
    listTradingAccounts: mockListTradingAccounts,
  }
})

describe('Trading widget accounts route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockListTradingAccounts.mockResolvedValue([
      { id: 'acct-1', type: 'paper', baseCurrency: 'USD' },
    ])
  })

  it('rejects invalid JSON payloads', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const request = new NextRequest('http://localhost/api/widgets/trading/accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
  })

  it('rejects schema-invalid request bodies', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 42,
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
  })

  it('rejects missing required fields', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const response = await POST(createMockRequest('POST', {}))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'provider is required' })
  })

  it('rejects unauthorized requests', async () => {
    mockGetSession.mockResolvedValue(null)

    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('rejects unsupported environments', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'demo',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported environment' })
  })

  it('rejects missing credentials and provider mismatches before broker calls', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')

    mockGetCredential.mockResolvedValueOnce(undefined)
    let response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-404',
        environment: 'paper',
      })
    )
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })

    mockGetCredential.mockResolvedValueOnce({ id: 'cred-1', providerId: 'tradier' })
    response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Credential does not match provider',
    })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('returns 401 when token refresh fails', async () => {
    mockRefreshAccessTokenIfNeeded.mockResolvedValueOnce(null)

    const { POST } = await import('@/app/api/widgets/trading/accounts/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to refresh access token',
    })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('maps broker failures to 502 and returns normalized accounts on success', async () => {
    const { POST } = await import('@/app/api/widgets/trading/accounts/route')

    mockListTradingAccounts.mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'upstream down',
        providerId: 'alpaca',
        status: 503,
        url: 'https://api.alpaca.markets/v2/account',
      })
    )

    let response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })

    mockListTradingAccounts.mockResolvedValueOnce([
      { id: 'acct-1', name: 'Paper', type: 'paper', baseCurrency: 'USD', status: 'active' },
    ])

    response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      accounts: [
        { id: 'acct-1', name: 'Paper', type: 'paper', baseCurrency: 'USD', status: 'active' },
      ],
    })
  })
})
