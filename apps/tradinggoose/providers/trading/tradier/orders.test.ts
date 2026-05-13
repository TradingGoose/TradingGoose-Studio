import { describe, expect, it } from 'vitest'
import type { ListingResolved } from '@/lib/listing/identity'
import { buildTradierOrderDetailRequest } from '@/providers/trading/tradier/orderDetail'
import { buildTradierOrderRequest } from '@/providers/trading/tradier/orders'

const stockListing: ListingResolved = {
  listing_type: 'default' as const,
  listing_id: 'AAPL',
  base_id: '',
  quote_id: '',
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock' as const,
}

describe('Tradier order request builder', () => {
  it('requires accountId and quantity', () => {
    expect(() =>
      buildTradierOrderRequest({
        listing: stockListing,
        side: 'buy',
        quantity: 1,
        accessToken: 'token',
      })
    ).toThrow('Tradier account ID is required')

    expect(() =>
      buildTradierOrderRequest({
        listing: stockListing,
        side: 'buy',
        accountId: 'ACC-1',
        accessToken: 'token',
      })
    ).toThrow('Quantity is required for Tradier orders')
  })

  it('defaults order class to equity and creates the form body', () => {
    const request = buildTradierOrderRequest({
      listing: stockListing,
      side: 'sell',
      quantity: 2,
      clientOrderId: 'client-order-1',
      accountId: 'ACC-1',
      accessToken: 'token',
      environment: 'live',
      orderType: 'limit',
      timeInForce: 'day',
      limitPrice: 123.45,
    })

    expect(request.url).toContain('/accounts/ACC-1/orders')
    expect(request.method).toBe('POST')
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(request.body).toContain('class=equity')
    expect(request.body).toContain('symbol=AAPL')
    expect(request.body).toContain('side=sell')
    expect(request.body).toContain('quantity=2')
    expect(request.body).toContain('type=limit')
    expect(request.body).toContain('duration=day')
    expect(request.body).toContain('price=123.45')
    expect(request.body).toContain('tag=client-order-1')
  })

  it('passes Tradier provider order params through the form body', () => {
    const request = buildTradierOrderRequest({
      listing: stockListing,
      side: 'buy',
      quantity: 1,
      accountId: 'ACC-1',
      accessToken: 'token',
      orderType: 'debit',
      orderClass: 'multileg',
      providerParams: {
        preview: true,
        legs: [
          { side: 'buy_to_open', quantity: 1, optionSymbol: 'AAPL260117C00100000' },
          { side: 'sell_to_open', quantity: 1, option_symbol: 'AAPL260117C00110000' },
        ],
      },
    })

    expect(request.body).toContain('class=multileg')
    expect(request.body).toContain('type=debit')
    expect(request.body).toContain('preview=true')
    expect(request.body).toContain('side%5B0%5D=buy_to_open')
    expect(request.body).toContain('option_symbol%5B1%5D=AAPL260117C00110000')
  })
})

describe('Tradier order detail request builder', () => {
  it('uses the account id recorded with the order history request', () => {
    const request = buildTradierOrderDetailRequest(
      'provider-order-1',
      {
        id: 'order-1',
        workspaceId: 'workspace-1',
        provider: 'tradier',
        environment: 'live',
        submissionSource: 'workflow',
        request: { accountId: 'ACC-RECORDED' },
        response: null,
        normalizedOrder: null,
      },
      { orderId: 'order-1', accessToken: 'token', accountId: 'ACC-OVERRIDE' }
    )

    expect(request.url).toBe(
      'https://api.tradier.com/v1/accounts/ACC-RECORDED/orders/provider-order-1'
    )
  })
})
