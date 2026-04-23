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
const mockGetTradingAccountSnapshot = vi.fn()

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
    getTradingAccountSnapshot: mockGetTradingAccountSnapshot,
  }
})

describe('Trading widget snapshot route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'tradier' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockListTradingAccounts.mockResolvedValue([
      { id: 'ACC-1', name: 'Main', type: 'cash', baseCurrency: 'USD', status: 'active' },
    ])
    mockGetTradingAccountSnapshot.mockResolvedValue({
      asOf: '2026-04-22T00:00:00.000Z',
      account: { id: 'ACC-1', type: 'unknown', baseCurrency: 'USD', status: 'unknown' },
      cashBalances: [],
      positions: [],
      orders: [],
      accountSummary: { totalPortfolioValue: 1000, totalCashValue: 1000 },
    })
  })

  it('rejects provider mismatches before snapshot resolution', async () => {
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })

    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Credential does not match provider',
    })
  })

  it('rejects invalid JSON payloads before shared preflight runs', async () => {
    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const request = new NextRequest('http://localhost/api/widgets/trading/snapshot', {
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
    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 42,
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('fails fast on missing accountId before refreshing auth or loading accounts', async () => {
    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'accountId is required' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('rejects unsupported environments before credential refresh', async () => {
    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'demo',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported environment' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('treats missing or non-owner credentials as the same 404 contract', async () => {
    mockGetCredential.mockResolvedValueOnce(undefined)

    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-404',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Credential not found' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
  })

  it('rejects accounts that do not belong to the selected credential', async () => {
    mockListTradingAccounts.mockResolvedValue([{ id: 'ACC-2', type: 'cash', baseCurrency: 'USD' }])

    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Account not found for credential',
    })
  })

  it('maps broker failures during account validation to 502', async () => {
    mockListTradingAccounts.mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'account discovery failed',
        providerId: 'tradier',
        status: 503,
        url: 'https://api.tradier.com/v1/user/profile',
      })
    )

    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
    expect(mockGetTradingAccountSnapshot).not.toHaveBeenCalled()
  })

  it('maps broker failures to 502 and returns snapshots on success', async () => {
    const { POST } = await import('@/app/api/widgets/trading/snapshot/route')

    mockGetTradingAccountSnapshot.mockRejectedValueOnce(
      new TradingBrokerRequestError({
        message: 'snapshot failed',
        providerId: 'tradier',
        status: 500,
        url: 'https://api.tradier.com/v1/accounts/ACC-1/balances',
      })
    )

    let response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })

    mockGetTradingAccountSnapshot.mockResolvedValueOnce({
      asOf: '2026-04-22T00:00:00.000Z',
      account: { id: 'ACC-1', type: 'unknown', baseCurrency: 'USD', status: 'unknown' },
      cashBalances: [],
      positions: [],
      orders: [],
      accountSummary: { totalPortfolioValue: 1000, totalCashValue: 1000 },
    })

    response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      snapshot: {
        asOf: '2026-04-22T00:00:00.000Z',
        account: {
          id: 'ACC-1',
          name: 'Main',
          type: 'cash',
          baseCurrency: 'USD',
          status: 'active',
        },
        cashBalances: [],
        positions: [],
        orders: [],
        accountSummary: { totalPortfolioValue: 1000, totalCashValue: 1000 },
      },
    })
  })
})
