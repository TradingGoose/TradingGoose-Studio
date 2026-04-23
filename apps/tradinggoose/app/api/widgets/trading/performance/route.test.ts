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
const mockGetTradingAccountPerformance = vi.fn()

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
    getTradingAccountPerformance: mockGetTradingAccountPerformance,
  }
})

describe('Trading widget performance route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockListTradingAccounts.mockResolvedValue([
      { id: 'acct-1', name: 'Paper', type: 'paper', baseCurrency: 'USD' },
    ])
    mockGetTradingAccountPerformance.mockResolvedValue({
      window: '1D',
      supportedWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
      series: [],
      summary: null,
      unavailableReason: 'No usable performance data returned by broker',
    })
  })

  it('rejects unsupported windows', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: 'MAX',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Unsupported performance window',
    })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockGetCredential).not.toHaveBeenCalled()
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockGetTradingAccountPerformance).not.toHaveBeenCalled()
  })

  it('does not mislabel unsupported providers as unsupported windows', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'unsupported-provider',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported provider' })
    expect(mockGetCredential).not.toHaveBeenCalled()
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockGetTradingAccountPerformance).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON payloads before shared preflight runs', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const request = new NextRequest('http://localhost/api/widgets/trading/performance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })

    const response = await POST(request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('rejects schema-invalid request bodies before shared preflight runs', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: ['1D'],
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('fails fast on missing window before refreshing auth or loading accounts', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'window is required' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('rejects unsupported environments before credential refresh', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'demo',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported environment' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('treats missing or non-owner credentials as the same 404 contract', async () => {
    mockGetCredential.mockResolvedValueOnce(undefined)

    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-404',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('returns 404 when the selected account is not available for the credential', async () => {
    mockListTradingAccounts.mockResolvedValueOnce([
      { id: 'acct-2', name: 'Secondary', type: 'paper', baseCurrency: 'USD' },
    ])

    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Account not found for credential',
    })
    expect(mockGetTradingAccountPerformance).not.toHaveBeenCalled()
  })

  it('returns 200 for valid no-data performance payloads', async () => {
    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      performance: {
        window: '1D',
        supportedWindows: ['1D', '1W', '1M', '3M', 'YTD', '1Y'],
        series: [],
        summary: null,
        unavailableReason: 'No usable performance data returned by broker',
      },
    })
  })

  it('maps broker failures during account validation to 502', async () => {
    mockListTradingAccounts.mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'account discovery failed',
        providerId: 'alpaca',
        status: 503,
        url: 'https://paper-api.alpaca.markets/v2/account',
      })
    )

    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
    expect(mockGetTradingAccountPerformance).not.toHaveBeenCalled()
  })

  it('maps broker failures to 502', async () => {
    mockGetTradingAccountPerformance.mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'history failed',
        providerId: 'alpaca',
        status: 503,
        url: 'https://paper-api.alpaca.markets/v2/account/portfolio/history',
      })
    )

    const { POST } = await import('@/app/api/widgets/trading/performance/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'acct-1',
        window: '1D',
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
  })
})
