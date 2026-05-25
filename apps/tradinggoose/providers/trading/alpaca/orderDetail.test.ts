import { describe, expect, it } from 'vitest'
import { buildAlpacaOrderDetailSiteUrl } from '@/providers/trading/alpaca/config'
import { buildAlpacaOrderDetailRequest } from '@/providers/trading/alpaca/orderDetail'

describe('Alpaca order detail request builder', () => {
  it('uses the environment recorded with the order history record', () => {
    const request = buildAlpacaOrderDetailRequest(
      'provider-order-1',
      {
        id: 'order-1',
        workspaceId: 'workspace-1',
        provider: 'alpaca',
        environment: 'paper',
        submissionSource: 'workflow',
        request: null,
        response: null,
        normalizedOrder: null,
      },
      { orderId: 'order-1', accessToken: 'token', environment: 'live' }
    )

    expect(request.url).toBe('https://paper-api.alpaca.markets/v2/orders/provider-order-1')
  })

  it('does not default missing order history environment to live', () => {
    expect(() =>
      buildAlpacaOrderDetailRequest(
        'provider-order-1',
        {
          id: 'order-1',
          workspaceId: 'workspace-1',
          provider: 'alpaca',
          environment: null,
          submissionSource: 'workflow',
          request: null,
          response: null,
          normalizedOrder: null,
        },
        { orderId: 'order-1', accessToken: 'token' }
      )
    ).toThrow('missing trading environment')
  })

  it('builds the Alpaca web order detail URL from the provider order id', () => {
    expect(buildAlpacaOrderDetailSiteUrl('provider-order-1')).toBe(
      'https://app.alpaca.markets/dashboard/order/provider-order-1'
    )
  })
})
