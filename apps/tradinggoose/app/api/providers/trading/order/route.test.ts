/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockRequest } from '@/app/api/__test-utils__/utils'

const mockGetSession = vi.fn()
const mockGetCredential = vi.fn()
const mockRefreshAccessTokenIfNeeded = vi.fn()
const mockListTradingAccounts = vi.fn()
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

const stockListing = {
  listing_type: 'default',
  listing_id: 'AAPL',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
}

const etfListing = {
  listing_type: 'default',
  listing_id: 'SPY',
  base: 'SPY',
  quote: 'USD',
  assetClass: 'etf',
}

describe('Trading provider order route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({ user: { id: 'user-1' } })
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'tradier' })
    mockRefreshAccessTokenIfNeeded.mockResolvedValue('access-token')
    mockListTradingAccounts.mockResolvedValue([
      { id: 'ACC-1', name: 'Main', type: 'cash', baseCurrency: 'USD', status: 'active' },
    ])
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          order: {
            id: 'order-1',
            status: 'submitted',
            symbol: 'AAPL',
            side: 'buy',
            create_date: '2026-04-25T12:00:00.000Z',
            message: 'Order accepted',
          },
        }),
        { status: 200 }
      )
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
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects invalid sides and numeric strings before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const invalidSideResponse = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'hold',
        quantity: 1,
      })
    )
    const numericStringResponse = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
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
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects listings without resolved asset class before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: { listing_type: 'default', listing_id: 'AAPL', base: 'AAPL' },
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Resolved listing asset class is required',
    })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects raw string listings before auth or broker calls', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: 'AAPL',
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it.each(['providerParams', 'class', 'tag', 'preview', 'optionSymbol', 'option_symbol', 'legs'])(
    'rejects unsupported top-level quick order extras: %s',
    async (field) => {
      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createMockRequest('POST', {
          provider: 'tradier',
          credentialId: 'cred-1',
          environment: 'live',
          accountId: 'ACC-1',
          listing: stockListing,
          side: 'buy',
          quantity: 1,
          [field]: field === 'legs' ? [] : 'advanced',
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
      expect(mockListTradingAccounts).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('rejects unsupported listing asset classes before account discovery', async () => {
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'ACC-1',
        listing: etfListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported listing for provider' })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects unsupported order types before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
        orderType: 'trailing_stop',
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Unsupported order type' })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects Alpaca notional trailing stop orders before account discovery', async () => {
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'ACC-1',
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
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
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
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'No supported order types for listing',
    })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()

    vi.doUnmock('@/providers/trading/order-types')
    vi.resetModules()
  })

  it('rejects credential provider mismatches before account discovery', async () => {
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Credential does not match provider' })
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('requires accountId before account discovery', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid request data' })
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(mockListTradingAccounts).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects accounts that do not belong to the selected credential', async () => {
    mockListTradingAccounts.mockResolvedValue([{ id: 'ACC-2', type: 'cash', baseCurrency: 'USD' }])

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: 'Account not found for credential',
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
      mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })

      const { POST } = await import('@/app/api/providers/trading/order/route')
      const response = await POST(
        createMockRequest('POST', {
          provider: 'alpaca',
          credentialId: 'cred-1',
          environment: 'paper',
          accountId: 'ACC-1',
          listing: stockListing,
          side: 'sell',
          quantity: 1,
          orderType: 'trailing_stop',
          ...fields,
        })
      )

      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ error })
      expect(mockListTradingAccounts).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    }
  )

  it('submits valid Alpaca quantity orders without using order history', async () => {
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })
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
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 3,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: 'alpaca',
      environment: 'paper',
      accountId: 'ACC-1',
      order: {
        id: 'alpaca-order-1',
        status: 'accepted',
        symbol: 'AAPL',
        side: 'buy',
      },
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://paper-api.alpaca.markets/v2/orders')
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
    mockGetCredential.mockResolvedValue({ id: 'cred-1', providerId: 'alpaca' })
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'alpaca-order-2', status: 'accepted' }), {
        status: 200,
      })
    )

    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'alpaca',
        credentialId: 'cred-1',
        environment: 'paper',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        orderSizingMode: 'notional',
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
  })

  it('submits valid Tradier equity quantity orders without using order history', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 3,
        limitPrice: 100,
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      provider: 'tradier',
      environment: 'live',
      accountId: 'ACC-1',
      message: 'Order accepted',
      order: {
        id: 'order-1',
        status: 'submitted',
        symbol: 'AAPL',
        side: 'buy',
      },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/accounts/ACC-1/orders')
    expect(url).not.toContain('/api/tools/trading/order-history')
    expect(String(init.body)).toContain('class=equity')
    expect(String(init.body)).toContain('symbol=AAPL')
    expect(String(init.body)).toContain('quantity=3')
    expect(String(init.body)).not.toContain('price=')
  })

  it('preserves listing enrichment fields in provider builders', async () => {
    const { POST } = await import('@/app/api/providers/trading/order/route')
    const response = await POST(
      createMockRequest('POST', {
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
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
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
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
        provider: 'tradier',
        credentialId: 'cred-1',
        environment: 'live',
        accountId: 'ACC-1',
        listing: stockListing,
        side: 'buy',
        quantity: 1,
      })
    )

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'Broker request failed' })
  })
})
