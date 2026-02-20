import { describe, expect, it } from 'vitest'
import { buildAlpacaOrderRequest } from '@/providers/trading/alpaca/orders'

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
  environment: 'paper' as const,
  accessToken: 'test-token',
}

describe('buildAlpacaOrderRequest', () => {
  it('uses notional when provided', () => {
    const request = buildAlpacaOrderRequest({
      ...baseParams,
      notional: 500.75,
    })

    expect(request.url).toBe('https://paper-api.alpaca.markets/v2/orders')
    expect(request.body).toMatchObject({
      notional: 500.75,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    })
    expect(request.body).not.toHaveProperty('qty')
  })

  it('uses qty when quantity is provided', () => {
    const request = buildAlpacaOrderRequest({
      ...baseParams,
      quantity: 2,
    })

    expect(request.body).toMatchObject({
      qty: '2',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    })
    expect(request.body).not.toHaveProperty('notional')
  })

  it('prefers quantity when both quantity and notional are provided', () => {
    const request = buildAlpacaOrderRequest({
      ...baseParams,
      quantity: 1,
      notional: 100,
    })

    expect(request.body).toMatchObject({
      qty: '1',
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    })
    expect(request.body).not.toHaveProperty('notional')
  })

  it('uses notional when orderSizingMode=notional', () => {
    const request = buildAlpacaOrderRequest({
      ...baseParams,
      quantity: 1,
      notional: 100,
      orderSizingMode: 'notional',
    } as typeof baseParams & { orderSizingMode: string; notional: number; quantity: number })

    expect(request.body).toMatchObject({
      notional: 100,
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
    })
    expect(request.body).not.toHaveProperty('qty')
  })

  it('requires notional when orderSizingMode=notional', () => {
    expect(() =>
      buildAlpacaOrderRequest({
        ...baseParams,
        quantity: 1,
        orderSizingMode: 'notional',
      } as typeof baseParams & { orderSizingMode: string; quantity: number })
    ).toThrow('orderSizingMode=notional')
  })

  it('rejects notional orders with non-day time in force', () => {
    expect(() =>
      buildAlpacaOrderRequest({
        ...baseParams,
        notional: 100,
        timeInForce: 'gtc',
      })
    ).toThrow('time_in_force=day')
  })

  it('supports trailing stop orders with trail price', () => {
    const request = buildAlpacaOrderRequest({
      ...baseParams,
      quantity: 1,
      orderType: 'trailing_stop',
      trailPrice: 1.5,
    })

    expect(request.body).toMatchObject({
      qty: '1',
      side: 'buy',
      type: 'trailing_stop',
      time_in_force: 'day',
      trail_price: 1.5,
    })
  })

  it('requires a single trailing stop offset', () => {
    expect(() =>
      buildAlpacaOrderRequest({
        ...baseParams,
        quantity: 1,
        orderType: 'trailing_stop',
      })
    ).toThrow('trailPrice or trailPercent')

    expect(() =>
      buildAlpacaOrderRequest({
        ...baseParams,
        quantity: 1,
        orderType: 'trailing_stop',
        trailPrice: 1,
        trailPercent: 2,
      })
    ).toThrow('trailPrice or trailPercent')
  })
})
