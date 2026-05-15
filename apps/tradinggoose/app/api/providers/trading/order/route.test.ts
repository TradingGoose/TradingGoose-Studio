/**
 * @vitest-environment node
 */

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TradingServiceError } from '@/lib/trading/errors'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockRefreshAccessTokenIfNeeded = vi.fn()
const mockListPortfolioIdentities = vi.fn()
const mockCheckWorkspaceAccess = vi.fn()
const mockAuthorizeCredentialUse = vi.fn()
const mockResolveOrderHistoryContext = vi.fn()
const mockRecordOrderHistory = vi.fn()
const mockUpdateOrderHistoryResult = vi.fn()
const mockFetch = vi.fn()
const idempotencyStore = new Map<string, unknown>()
let idempotencyCounter = 0

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

vi.mock('@/lib/oauth/tokens', () => ({
  refreshAccessTokenIfNeeded: mockRefreshAccessTokenIfNeeded,
}))

vi.mock('@/lib/auth/credential-access', () => ({
  authorizeCredentialUse: mockAuthorizeCredentialUse,
}))

vi.mock('@/lib/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/trading/order-history', () => ({
  resolveOrderHistoryContext: mockResolveOrderHistoryContext,
  recordOrderHistory: mockRecordOrderHistory,
  updateOrderHistoryResult: mockUpdateOrderHistoryResult,
}))

vi.mock('@/lib/idempotency', () => ({
  IdempotencyService: class {
    async executeWithIdempotency(
      _provider: string,
      identifier: string,
      operation: () => Promise<unknown>
    ) {
      if (idempotencyStore.has(identifier)) return idempotencyStore.get(identifier)
      const result = await operation()
      idempotencyStore.set(identifier, result)
      return result
    }
  },
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
  serviceId: `${providerId}-live`,
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

const nextIdempotencyKey = () => `test-order-idempotency-${(idempotencyCounter += 1)}`

const createOrderRequest = (body: Record<string, unknown>, idempotencyKey = nextIdempotencyKey()) =>
  createMockRequest('POST', {
    idempotencyKey,
    ...body,
  })

const orderBodyFor = (
  providerId: 'alpaca' | 'tradier',
  overrides: Record<string, unknown> = {}
) => ({
  workspaceId,
  portfolioIdentity: portfolioIdentityFor(providerId),
  listing: stockListing,
  side: 'buy',
  quantity: 1,
  ...overrides,
})

const createProviderOrderRequest = (
  providerId: 'alpaca' | 'tradier',
  overrides?: Record<string, unknown>,
  idempotencyKey?: string
) => createOrderRequest(orderBodyFor(providerId, overrides), idempotencyKey)

const expectNoAccountDiscoveryOrBrokerCall = () => {
  expect(mockListPortfolioIdentities).not.toHaveBeenCalled()
  expect(mockFetch).not.toHaveBeenCalled()
}

describe('Trading provider order route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    idempotencyStore.clear()
    idempotencyCounter = 0
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockAuthorizeCredentialUse.mockImplementation(
      (_request: unknown, { credentialId }: { credentialId: string }) =>
        Promise.resolve({
          ok: true,
          authType: 'session',
          requesterUserId: 'user-1',
          credentialOwnerUserId: 'user-1',
          resolvedTokenAccountId: 'account-credential-1',
          resolvedProviderId: credentialId.startsWith('tradier') ? 'tradier-live' : 'alpaca-live',
        })
    )
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: true,
      workspace: { id: workspaceId },
    })
    mockResolveOrderHistoryContext.mockResolvedValue({
      submissionSource: 'manual',
      logId: null,
    })
    mockRecordOrderHistory.mockResolvedValue({ id: 'app-order-1' })
    mockUpdateOrderHistoryResult.mockResolvedValue({ id: 'app-order-1' })
    mockListPortfolioIdentities.mockResolvedValue([
      {
        providerId: 'alpaca',
        credentialId: 'alpaca-credential-1',
        serviceId: 'alpaca-live',
        accountId: 'ACC-1',
        accountName: 'Main',
        accountType: 'cash',
        baseCurrency: 'USD',
        accountStatus: 'active',
      },
      {
        providerId: 'tradier',
        credentialId: 'tradier-credential-1',
        serviceId: 'tradier-live',
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
      new NextRequest('http://localhost:3000/api/providers/trading/order', {
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

  it('authorizes the selected portfolio credential before token lookup', async () => {
    mockAuthorizeCredentialUse.mockResolvedValue({
      ok: false,
      error: 'Unauthorized',
    })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects portfolio identities whose credential service does not match the requested service', async () => {
    mockAuthorizeCredentialUse.mockResolvedValueOnce({
      ok: true,
      authType: 'session',
      requesterUserId: 'user-1',
      credentialOwnerUserId: 'user-1',
      resolvedTokenAccountId: 'account-credential-1',
      resolvedProviderId: 'alpaca-live',
    })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Trading provider connection does not match requested service',
    })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects invalid sides and numeric strings before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const invalidSideResponse = await POST(
      createProviderOrderRequest('tradier', {
        side: 'hold',
      })
    )
    const numericStringResponse = await POST(
      createProviderOrderRequest('tradier', {
        quantity: '1',
      })
    )

    expect(invalidSideResponse.status).toBe(400)
    await expect(invalidSideResponse.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(numericStringResponse.status).toBe(400)
    await expect(numericStringResponse.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('requires idempotencyKey before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createMockRequest('POST', orderBodyFor('tradier')))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('requires workspaceId before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createOrderRequest({
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
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects unresolved listings that cannot be hydrated before account discovery', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }))

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('tradier', {
        listing: { listing_type: 'default', listing_id: 'UNKNOWN', base: 'UNKNOWN' },
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
      createProviderOrderRequest('tradier', {
        listing: 'AAPL',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it.each(['providerParams', 'rawProviderPayload', 'accessToken'])(
    'rejects unsupported top-level quick order extras: %s',
    async (field) => {
      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createProviderOrderRequest('tradier', {
          [field]: 'advanced',
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
      expectNoAccountDiscoveryOrBrokerCall()
    }
  )

  it('rejects unsupported listing asset classes before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('alpaca', {
        listing: etfListing,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported listing for provider' })
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects unsupported order types before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('tradier', {
        orderType: 'trailing_stop',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported order type' })
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects Alpaca notional trailing stop orders before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('alpaca', {
        quantity: undefined,
        orderSizingMode: 'notional',
        notional: 100,
        orderType: 'trailing_stop',
        timeInForce: 'day',
        trailPrice: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Notional sizing is not supported for this order type',
    })
    expectNoAccountDiscoveryOrBrokerCall()
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
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No supported order types for listing',
    })
    expectNoAccountDiscoveryOrBrokerCall()

    vi.doUnmock('@/providers/trading/order-types')
    vi.resetModules()
  })

  it('rejects missing provider connections before account discovery', async () => {
    mockRefreshAccessTokenIfNeeded.mockResolvedValue(null)

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Trading provider connection not found',
    })
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('requires workspace write access before account discovery', async () => {
    mockCheckWorkspaceAccess.mockResolvedValue({
      exists: true,
      hasAccess: true,
      canWrite: false,
      workspace: { id: workspaceId },
    })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith(workspaceId, 'user-1')
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('validates linked order history context before broker submission', async () => {
    mockResolveOrderHistoryContext.mockRejectedValueOnce(
      new TradingServiceError('logId does not belong to the workspace')
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('tradier', {
        submissionSource: 'workflow',
        logId: 'foreign-log',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'logId does not belong to the workspace',
    })
    expect(mockRefreshAccessTokenIfNeeded).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
    expect(mockRecordOrderHistory).not.toHaveBeenCalled()
  })

  it('derives manual audit context for session submissions instead of trusting request fields', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'alpaca-order-1', status: 'accepted' }), {
        status: 200,
      })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('alpaca', {
        submissionSource: 'workflow',
        logId: 'spoofed-log',
      })
    )

    expect(response.status).toBe(200)
    expect(mockResolveOrderHistoryContext).toHaveBeenCalledWith({
      workspaceId,
      submissionSource: 'manual',
      logId: undefined,
    })
  })

  it('requires portfolioIdentity before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createOrderRequest({
        workspaceId,
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expectNoAccountDiscoveryOrBrokerCall()
  })

  it('rejects accounts that do not belong to the provider connection', async () => {
    mockListPortfolioIdentities.mockResolvedValue([
      {
        providerId: 'tradier',
        credentialId: 'tradier-credential-1',
        serviceId: 'tradier-live',
        accountId: 'ACC-2',
      },
    ])

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier'))

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
      'trailPrice or trailPercent is required',
    ],
    [{}, 'trailPrice or trailPercent is required'],
    [
      {
        trailPrice: 1,
        limitPrice: 100,
      },
      'limitPrice is not supported for this order type',
    ],
  ])(
    'rejects invalid Alpaca trailing stop payloads before account discovery',
    async (fields, error) => {
      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createProviderOrderRequest('alpaca', {
          side: 'sell',
          orderType: 'trailing_stop',
          ...fields,
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error })
      expectNoAccountDiscoveryOrBrokerCall()
    }
  )

  it('submits valid Alpaca quantity orders through the canonical route', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
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
      createProviderOrderRequest('alpaca', { quantity: 3 }, idempotencyKey)
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      appOrderId: 'app-order-1',
      clientOrderId,
      provider: 'alpaca',
      accountId: 'ACC-1',
      order: {
        id: 'alpaca-order-1',
        clientOrderId,
        status: 'accepted',
        symbol: 'AAPL',
        side: 'buy',
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockRefreshAccessTokenIfNeeded).toHaveBeenCalledWith(
      'account-credential-1',
      'user-1',
      expect.any(String)
    )
    expect(mockRecordOrderHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        provider: 'alpaca',
        environment: 'live',
        submissionSource: 'manual',
        request: expect.objectContaining({
          accountId: 'ACC-1',
          clientOrderId,
          credentialId: 'alpaca-credential-1',
          serviceId: 'alpaca-live',
          orderType: 'market',
          quantity: 3,
          side: 'buy',
          timeInForce: 'day',
        }),
        response: {
          clientOrderId,
          success: false,
          status: 'pending',
        },
      })
    )
    expect(mockRecordOrderHistory.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[0]
    )
    expect(mockUpdateOrderHistoryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'app-order-1',
        workspaceId,
        response: expect.objectContaining({
          clientOrderId,
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
      client_order_id: clientOrderId,
    })
  })

  it('submits valid Alpaca notional orders without sending quantity', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'alpaca-order-2', status: 'accepted' }), {
        status: 200,
      })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest(
        'alpaca',
        {
          orderSizingMode: 'notional',
          quantity: 3,
          notional: 100.5,
          timeInForce: 'day',
        },
        idempotencyKey
      )
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
      client_order_id: clientOrderId,
    })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('qty')
    const recordInput = mockRecordOrderHistory.mock.calls[0]?.[0]
    expect(recordInput.request).not.toHaveProperty('quantity')
    expect(recordInput.request.clientOrderId).toEqual(clientOrderId)
  })

  it('submits valid Tradier equity quantity orders through the canonical route', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
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
      createProviderOrderRequest(
        'tradier',
        {
          listing: bareStockListing,
          orderSizingMode: 'quantity',
          quantity: 3,
          limitPrice: 100,
        },
        idempotencyKey
      )
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      clientOrderId,
      provider: 'tradier',
      accountId: 'ACC-1',
      message: 'Order accepted',
      order: {
        id: 'order-1',
        clientOrderId,
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
    expect(String(init.body)).toMatch(/tag=tg-[0-9a-f]{32}/)
    expect(String(init.body)).not.toContain('price=')
    expect(mockRecordOrderHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        provider: 'tradier',
        environment: 'live',
        submissionSource: 'manual',
        request: expect.objectContaining({
          accountId: 'ACC-1',
          clientOrderId,
          credentialId: 'tradier-credential-1',
          serviceId: 'tradier-live',
          quantity: 3,
          side: 'buy',
        }),
      })
    )
  })
  it('preserves listing enrichment fields in provider builders', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createProviderOrderRequest('tradier', {
        listing: {
          ...stockListing,
          listing_id: 'IGNORED',
          base: 'TSLA',
          marketCode: 'NASDAQ',
          countryCode: 'US',
          cityName: 'New York',
        },
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
    const response = await POST(createProviderOrderRequest('tradier'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      message: 'Insufficient buying power',
    })
  })

  it('records failed broker submissions before returning 502', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Broker unavailable' }), { status: 500 })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('tradier', undefined, idempotencyKey))

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
    expect(mockRecordOrderHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        provider: 'tradier',
        environment: 'live',
        response: {
          clientOrderId,
          success: false,
          status: 'pending',
        },
      })
    )
    expect(mockUpdateOrderHistoryResult).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'app-order-1',
        workspaceId,
        response: expect.objectContaining({
          clientOrderId,
          success: false,
          status: 'failed',
          httpStatus: 500,
          raw: { error: 'Broker unavailable' },
        }),
      })
    )
  })

  it('returns accepted broker orders when local history update fails after submission', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
    mockUpdateOrderHistoryResult.mockRejectedValueOnce(new Error('database unavailable'))
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'alpaca-order-3', status: 'accepted' }), {
        status: 200,
      })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(createProviderOrderRequest('alpaca', undefined, idempotencyKey))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      appOrderId: 'app-order-1',
      clientOrderId,
      provider: 'alpaca',
      historyWarning:
        'Order was accepted by the broker, but Trading Goose could not update order history.',
      order: {
        id: 'alpaca-order-3',
        clientOrderId,
        status: 'accepted',
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockRecordOrderHistory.mock.invocationCallOrder[0]).toBeLessThan(
      mockFetch.mock.invocationCallOrder[0]
    )
  })

  it('replays the first successful order submission for the same idempotency key', async () => {
    const idempotencyKey = nextIdempotencyKey()
    const clientOrderId = expect.stringMatching(/^tg-[0-9a-f]{32}$/)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'alpaca-order-4',
          status: 'accepted',
        }),
        {
          status: 200,
        }
      )
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const requestBody = orderBodyFor('alpaca')

    const firstResponse = await POST(createOrderRequest(requestBody, idempotencyKey))
    const secondResponse = await POST(createOrderRequest(requestBody, idempotencyKey))

    expect(firstResponse.status).toBe(200)
    expect(secondResponse.status).toBe(200)
    await expect(firstResponse.json()).resolves.toMatchObject({
      appOrderId: 'app-order-1',
      clientOrderId,
      order: { id: 'alpaca-order-4', clientOrderId },
    })
    await expect(secondResponse.json()).resolves.toMatchObject({
      appOrderId: 'app-order-1',
      clientOrderId,
      order: { id: 'alpaca-order-4', clientOrderId },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockRecordOrderHistory).toHaveBeenCalledTimes(1)
    expect(mockUpdateOrderHistoryResult).toHaveBeenCalledTimes(1)
  })
})
