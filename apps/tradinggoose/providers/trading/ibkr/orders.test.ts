import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheIbkrConid, clearIbkrConidCache } from '@/providers/trading/ibkr/client'
import { buildIbkrOrderRequest } from '@/providers/trading/ibkr/orders'

const baseParams = {
  listing: {
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
    listing_type: 'default' as const,
  },
  side: 'buy' as const,
  orderType: 'market' as const,
  timeInForce: 'day' as const,
  accessToken: 'test-token',
  accountId: 'DU123456',
  quantity: 10,
  orderSizingMode: 'quantity' as const,
}

describe('buildIbkrOrderRequest', () => {
  beforeEach(() => {
    clearIbkrConidCache()
    cacheIbkrConid('STK:AAPL', 265598)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds a market order request', () => {
    const request = buildIbkrOrderRequest(baseParams)

    expect(request.url).toBe('http://127.0.0.1:5000/v1/api/portfolio/DU123456/orders')
    expect(request.method).toBe('POST')
    expect(request.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    // Gateway mode authenticates with the browser session, so no bearer token.
    expect(request.headers).not.toHaveProperty('Authorization')
    expect(request.body).toMatchObject({
      conid: 265598,
      conidSpec: 'STK',
      side: 'BUY',
      quantity: '10',
      orderType: 'MKT',
      tif: 'DAY',
    })
  })

  it('maps clientOrderId to orderRef', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      clientOrderId: 'tg-abc123',
    })

    expect(request.body).toMatchObject({ orderRef: 'tg-abc123' })
  })

  it('builds a limit order with price', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      orderType: 'limit',
      limitPrice: 250.5,
    })

    expect(request.body).toMatchObject({
      orderType: 'LMT',
      price: 250.5,
    })
  })

  it('builds a stop order with auxPrice', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      orderType: 'stop',
      stopPrice: 240,
    })

    expect(request.body).toMatchObject({
      orderType: 'STP',
      auxPrice: 240,
    })
  })

  it('builds a stop limit order', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      orderType: 'stop_limit',
      stopPrice: 240,
      limitPrice: 238,
    })

    expect(request.body).toMatchObject({
      orderType: 'STP LMT',
      auxPrice: 240,
      price: 238,
    })
  })

  it('builds a trailing stop with trailPrice', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      orderType: 'trailing_stop',
      trailPrice: 1.5,
    })

    expect(request.body).toMatchObject({
      orderType: 'TRAIL',
      auxPrice: 1.5,
    })
  })

  it('builds a trailing stop with trailPercent', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      orderType: 'trailing_stop',
      trailPercent: 2,
    })

    expect(request.body).toMatchObject({
      orderType: 'TRAIL',
      trailingPercent: 2,
    })
  })

  it('rejects trailing stop without trail fields', () => {
    expect(() =>
      buildIbkrOrderRequest({
        ...baseParams,
        orderType: 'trailing_stop',
      })
    ).toThrow('either trailPrice or trailPercent')
  })

  it('rejects notional sizing', () => {
    expect(() =>
      buildIbkrOrderRequest({
        ...baseParams,
        orderSizingMode: 'notional',
        notional: 1000,
      })
    ).toThrow('notional')
  })

  it('rejects missing quantity', () => {
    expect(() =>
      buildIbkrOrderRequest({
        ...baseParams,
        quantity: undefined as unknown as number,
      })
    ).toThrow('quantity')
  })

  it('rejects unsupported order type', () => {
    expect(() =>
      buildIbkrOrderRequest({
        ...baseParams,
        orderType: 'pegged' as never,
      })
    ).toThrow('Unsupported order type')
  })

  it('throws when conid is not cached', () => {
    clearIbkrConidCache()
    expect(() => buildIbkrOrderRequest(baseParams)).toThrow('contract identifier not resolved')
  })

  it('sells short as negative quantity', () => {
    const request = buildIbkrOrderRequest({
      ...baseParams,
      side: 'sell',
      quantity: 5,
    })

    expect(request.body).toMatchObject({
      side: 'SELL',
      quantity: '5',
    })
  })

  it('sends a bearer token and the originating ip against the hosted API', () => {
    vi.stubEnv('IBKR_API_BASE_URL', 'https://api.ibkr.com/v1/api')

    const request = buildIbkrOrderRequest(baseParams)

    expect(request.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer test-token',
      ip: '127.0.0.1',
      'Content-Type': 'application/json',
    })
  })
})
