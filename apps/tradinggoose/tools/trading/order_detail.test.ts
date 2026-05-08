import { describe, expect, it } from 'vitest'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'

describe('tradingOrderDetailTool contract', () => {
  it('preserves workspace and log ids from the route response', async () => {
    const response = {
      json: async () => ({
        data: {
          appOrderId: 'order-1',
          orderDetail: { status: 'filled' },
          provider: 'alpaca',
          providerOrderId: 'provider-order-1',
          logId: 'log-1',
          workspaceId: 'workspace-1',
        },
      }),
    } as Response

    const result = await tradingOrderDetailTool.transformResponse?.(response)

    expect(result?.output).toEqual(
      expect.objectContaining({
        appOrderId: 'order-1',
        provider: 'alpaca',
        providerOrderId: 'provider-order-1',
        logId: 'log-1',
        workspaceId: 'workspace-1',
      })
    )
  })
})
