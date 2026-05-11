/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetOAuthTokenByCredentialId = vi.fn()
const mockListPortfolioIdentities = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
const mockRecordOrderHistory = vi.fn()
const mockFetch = vi.fn()

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
  getOAuthTokenByCredentialId: mockGetOAuthTokenByCredentialId,
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/records/order-history.server', () => ({
  recordOrderHistory: mockRecordOrderHistory,
}))

vi.mock('@/providers/trading/portfolio', async () => {
  const actual = await vi.importActual('@/providers/trading/portfolio')
  return {
    ...(actual as object),
    listPortfolioIdentities: mockListPortfolioIdentities,
  }
})

const stockListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const bareStockListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
}

const etfListing = {
  listing_type: 'default',
  listing_id: 'SPY',
  base: 'SPY',
  quote: 'USD',
  assetClass: 'etf',
}

const workspaceId = 'workspace-1'

const portfolioIdentityFor = (providerId: 'alpaca' | 'tradier', accountId = 'ACC-1') => ({
  providerId,
  credentialId: `${providerId}-credential-1`,
  credentialServiceId: `${providerId}-live`,
  accountId,
})

const marketListingRow = {
  listing_id: 'TG_LSTG_AAPL',
  base_id: null,
  quote_id: null,
  listing_type: 'default',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('Trading provider order route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetOAuthTokenByCredentialId.mockResolvedValue('access-token')
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: workspaceId },
    })
    mockRecordOrderHistory.mockResolvedValue({
      ok: true,
      record: { id: 'app-order-1' },
    })
    mockListPortfolioIdentities.mockResolvedValue([
      {
        providerId: 'alpaca',
        credentialId: 'alpaca-credential-1',
        credentialServiceId: 'alpaca-live',
        accountId: 'ACC-1',
        accountName: 'Main',
        accountType: 'cash',
        baseCurrency: 'USD',
        accountStatus: 'active',
      },
      {
        providerId: 'tradier',
        credentialId: 'tradier-credential-1',
        credentialServiceId: 'tradier-live',
        accountId: 'ACC-1',
        accountName: 'Main',
        accountType: 'cash',
        baseCurrency: 'USD',
        accountStatus: 'active',
      },
    ])
    mockFetch.mockResolvedValue(
      jsonResponse({
        order: {
          id: 'order-1',
          status: 'submitted',
          symbol: 'AAPL',
          side: 'buy',
          create_date: '2026-04-25T12:00:00.000Z',
          message: 'Order accepted',
        },
      })
    )
  })

  it('rejects invalid JSON before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      new Request('http://localhost:3000/api/providers/trading/order', {
        method: 'POST',
        body: '{',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects invalid sides and numeric strings before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const invalidSideResponse = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'hold',
        quantity: 1,
      })
    )
    const numericStringResponse = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: '1',
      })
    )

    expect(invalidSideResponse.status).toBe(400)
    await expect(invalidSideResponse.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(numericStringResponse.status).toBe(400)
    await expect(numericStringResponse.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('requires workspaceId before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockCheckWorkspaceAccess).not.toHaveBeenCalled()
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects unresolved listings that cannot be hydrated before account discovery', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }))

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: { listing_type: 'default', listing_id: 'UNKNOWN', base: 'UNKNOWN' },
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Unable to resolve listing details for order',
    })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('rejects raw string listings before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: 'AAPL',
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['providerParams', 'class', 'tag', 'preview', 'optionSymbol', 'option_symbol', 'legs'])(
    'rejects unsupported top-level quick order extras: %s',
    async (field) => {
      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createMockRequest('POST', {
          workspaceId,
          portfolioIdentity: portfolioIdentityFor('tradier'),
          listing: stockListing,
          side: 'buy',
          quantity: 1,
          [field]: field === 'legs' ? [] : 'advanced',
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
      expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects unsupported listing asset classes before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('alpaca'),
        listing: etfListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported listing for provider' })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects unsupported order types before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
        orderType: 'trailing_stop',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported order type' })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects Alpaca notional trailing stop orders before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('alpaca'),
        listing: stockListing,
        side: 'buy',
        orderSizingMode: 'notional',
        notional: 100,
        orderType: 'trailing_stop',
        timeInForce: 'day',
        trailPrice: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Alpaca notional orders support market, limit, stop, or stop_limit types.',
    })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects no supported order types before account discovery', async () => {
    vi.resetModules()
    vi.doMock('@/providers/trading/order-types', async () => {
      const actual = await vi.importActual<typeof import('@/providers/trading/order-types')>(
        '@/providers/trading/order-types'
      )
      return {
        ...actual,
        getStrictTradingOrderTypeDefinitions: vi.fn(() => []),
      }
    })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No supported order types for listing',
    })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()

    vi.doUnmock('@/providers/trading/order-types')
    vi.resetModules()
  })

  it('rejects missing provider connections before account discovery', async () => {
    mockGetOAuthTokenByCredentialId.mockResolvedValue(null)

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Trading provider connection not found',
    })
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('requires workspace write access before account discovery', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: workspaceId },
    })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith(workspaceId, 'user-1')
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('requires portfolioIdentity before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects accounts that do not belong to the provider connection', async () => {
    mockListPortfolioIdentities.mockResolvedValue([
      {
        providerId: 'tradier',
        credentialId: 'tradier-credential-1',
        credentialServiceId: 'tradier-live',
        accountId: 'ACC-2',
      },
    ])

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Account not found for provider connection',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each([
    [
      {
        trailPrice: 1,
        trailPercent: 1,
      },
      'Enter either trail price or trail percent.',
    ],
    [{}, 'Enter either trail price or trail percent.'],
    [
      {
        trailPrice: 1,
        limitPrice: 100,
      },
      'Alpaca trailing stop orders do not accept limitPrice or stopPrice',
    ],
  ])(
    'rejects invalid Alpaca trailing stop payloads before account discovery',
    async (fields, error) => {
      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createMockRequest('POST', {
          workspaceId,
          portfolioIdentity: portfolioIdentityFor('alpaca'),
          listing: stockListing,
          side: 'sell',
          quantity: 1,
          orderType: 'trailing_stop',
          ...fields,
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error })
      expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('submits valid Alpaca quantity orders through the canonical route', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'alpaca-order-1',
          status: 'accepted',
          symbol: 'AAPL',
          side: 'buy',
          submitted_at: '2026-04-25T12:00:00.000Z',
        }),
        { status: 200 }
      )
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('alpaca'),
        listing: stockListing,
        side: 'buy',
        quantity: 3,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      appOrderId: 'app-order-1',
      provider: 'alpaca',
      accountId: 'ACC-1',
      order: {
        id: 'alpaca-order-1',
        status: 'accepted',
        symbol: 'AAPL',
        side: 'buy',
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockGetOAuthTokenByCredentialId).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        credentialId: 'alpaca-credential-1',
        providerId: 'alpaca-live',
      })
    )
    expect(mockRecordOrderHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        provider: 'alpaca',
        environment: 'live',
        submissionSource: 'manual',
        request: expect.objectContaining({
          accountId: 'ACC-1',
          credentialId: 'alpaca-credential-1',
          credentialServiceId: 'alpaca-live',
          orderType: 'market',
          quantity: 3,
          side: 'buy',
          timeInForce: 'day',
        }),
        response: expect.objectContaining({
          orderId: 'alpaca-order-1',
          success: true,
        }),
      })
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.alpaca.markets/v2/orders')
    expect(url).not.toContain('/api/tools/trading/order-history')
    expect(JSON.parse(String(init.body))).toMatchObject({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      qty: '3',
    })
  })

  it('submits valid Alpaca notional orders without sending quantity', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'alpaca-order-2', status: 'accepted' }), {
        status: 200,
      })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('alpaca'),
        listing: stockListing,
        side: 'buy',
        orderSizingMode: 'notional',
        quantity: 3,
        notional: 100.5,
        timeInForce: 'day',
      })
    )

    expect(response.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      symbol: 'AAPL',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      notional: 100.5,
    })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('qty')
    const recordInput = mockRecordOrderHistory.mock.calls[0]?.[0]
    expect(recordInput.request).not.toHaveProperty('quantity')
  })

  it('submits valid Tradier equity quantity orders through the canonical route', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({ data: [marketListingRow] }))
      .mockResolvedValueOnce(jsonResponse({ data: marketListingRow }))
      .mockResolvedValueOnce(
        jsonResponse({
          order: {
            id: 'order-1',
            status: 'submitted',
            symbol: 'AAPL',
            side: 'buy',
            create_date: '2026-04-25T12:00:00.000Z',
            message: 'Order accepted',
          },
        })
      )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: bareStockListing,
        side: 'buy',
        orderSizingMode: 'quantity',
        quantity: 3,
        limitPrice: 100,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: 'tradier',
      accountId: 'ACC-1',
      message: 'Order accepted',
      order: {
        id: 'order-1',
        status: 'submitted',
        symbol: 'AAPL',
        side: 'buy',
      },
    })

    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/api/market/search?')
    expect(String(mockFetch.mock.calls[1]?.[0])).toContain('/api/market/get/listing?')
    const [url, init] = mockFetch.mock.calls[2] as [string, RequestInit]
    expect(url).toContain('/accounts/ACC-1/orders')
    expect(url).not.toContain('/api/tools/trading/order-history')
    expect(String(init.body)).toContain('class=equity')
    expect(String(init.body)).toContain('symbol=AAPL')
    expect(String(init.body)).toContain('quantity=3')
    expect(String(init.body)).not.toContain('price=')
    expect(mockRecordOrderHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        provider: 'tradier',
        environment: 'live',
        submissionSource: 'manual',
        request: expect.objectContaining({
          accountId: 'ACC-1',
          credentialId: 'tradier-credential-1',
          credentialServiceId: 'tradier-live',
          orderClass: 'equity',
          quantity: 3,
          side: 'buy',
        }),
      })
    )
  })

  it('preserves listing enrichment fields in provider builders', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: {
          ...stockListing,
          listing_id: 'IGNORED',
          base: 'TSLA',
          marketCode: 'NASDAQ',
          countryCode: 'US',
          cityName: 'New York',
        },
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(200)
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(init.body)).toContain('symbol=TSLA')
    expect(String(init.body)).not.toContain('IGNORED')
  })

  it('extracts broker message-like fields into the quick order response', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          order: {
            id: 'order-2',
            status: 'rejected',
            symbol: 'AAPL',
            reject_reason: 'Insufficient buying power',
          },
        }),
        { status: 200 }
      )
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Insufficient buying power',
    })
  })

  it('maps broker fetch failures to 502 without persisting', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Broker unavailable' }), { status: 500 })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        workspaceId,
        portfolioIdentity: portfolioIdentityFor('tradier'),
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
    expect(mockRecordOrderHistory).not.toHaveBeenCalled()
  })
})
