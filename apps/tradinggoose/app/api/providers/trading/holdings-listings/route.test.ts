/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockResolveTradingProviderPreflight = vi.fn()
const mockResolveTradingProviderAccountContext = vi.fn()
const mockGetTradingAccountSnapshot = vi.fn()
const mockLogBrokerRequestFailure = vi.fn()

vi.mock('@/app/api/providers/trading/shared', () => ({
  createTradingProviderRequestId: () => 'request-1',
  logBrokerRequestFailure: (...args: unknown[]) => mockLogBrokerRequestFailure(...args),
  resolveTradingProviderPreflight: mockResolveTradingProviderPreflight,
  resolveTradingProviderAccountContext: mockResolveTradingProviderAccountContext,
  tradingAccountIdentitySchema: z.object({
    provider: z.string().optional(),
    credentialId: z.string().optional(),
    environment: z.string().optional(),
    accountId: z.string().optional(),
  }),
}))

vi.mock('@/providers/trading/portfolio', () => ({
  getTradingAccountSnapshot: mockGetTradingAccountSnapshot,
}))

describe('trading holdings listings route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveTradingProviderPreflight.mockResolvedValue({
      provider: 'alpaca',
      credentialId: 'credential-1',
      environment: 'paper',
      accountId: 'account-1',
    })
    mockResolveTradingProviderAccountContext.mockResolvedValue({
      providerId: 'alpaca',
      credentialId: 'credential-1',
      environment: 'paper',
      accountId: 'account-1',
      accessToken: 'token',
      sessionUserId: 'user-1',
      requestId: 'request-1',
      account: {
        id: 'account-1',
        type: 'paper',
        baseCurrency: 'USD',
      },
    })
  })

  it('returns deduped listing identities from normalized position symbols', async () => {
    const listing = {
      listing_id: 'TG_LSTG_AAPL',
      base_id: '',
      quote_id: '',
      listing_type: 'default',
    }
    mockGetTradingAccountSnapshot.mockResolvedValue({
      positions: [
        { symbol: { base: 'AAPL', listing }, quantity: 2 },
        { symbol: { base: 'AAPL', listing }, quantity: -1 },
        { symbol: {} },
      ],
    })

    const { POST } = await import('@/app/api/providers/trading/holdings-listings/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'credential-1',
        environment: 'paper',
        accountId: 'account-1',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      positionListings: [
        {
          listing,
          grossQuantity: 3,
          signedQuantity: 1,
        },
      ],
    })
    expect(mockResolveTradingProviderAccountContext).toHaveBeenCalledWith({
      requestData: {
        provider: 'alpaca',
        credentialId: 'credential-1',
        environment: 'paper',
        accountId: 'account-1',
      },
      requestId: 'request-1',
    })
  })

  it('returns broker failures with the shared trading widget failure contract', async () => {
    const error = new Error('broker auth failed')
    mockGetTradingAccountSnapshot.mockRejectedValue(error)

    const { POST } = await import('@/app/api/providers/trading/holdings-listings/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'credential-1',
        environment: 'paper',
        accountId: 'account-1',
      })
    )
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.error).toBe('Broker request failed')
    expect(mockLogBrokerRequestFailure).toHaveBeenCalledWith('holdings-listings', error)
  })
})
