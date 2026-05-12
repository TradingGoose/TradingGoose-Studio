import { describe, expect, it } from 'vitest'
import { TradingActionBlock } from '@/blocks/blocks/trading_action'
import { TradingOrderDetailBlock } from '@/blocks/blocks/trading_order_detail'
import { TradingOrderHistoryBlock } from '@/blocks/blocks/trading_order_history'
import { tradingOrderDetailTool } from '@/tools/trading/order_detail'
import { orderHistoryTool } from '@/tools/trading/order_history'

describe('trading order block contracts', () => {
  it('exposes workspace scope on order-history tool and block outputs', () => {
    expect(orderHistoryTool.outputs).toHaveProperty('workspaceId')
    expect(orderHistoryTool.outputs?.history.items?.properties).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        submissionSource: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
    expect(TradingOrderHistoryBlock.outputs).toHaveProperty('workspaceId')
  })

  it('exposes workspace and log provenance on order-detail outputs', () => {
    expect(tradingOrderDetailTool.outputs).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
    expect(TradingOrderDetailBlock.outputs).toEqual(
      expect.objectContaining({
        logId: expect.any(Object),
        workspaceId: expect.any(Object),
      })
    )
  })

  it('invalidates order type options when the selected listing changes', () => {
    const orderType = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'orderType')

    expect(orderType?.dependsOn).toEqual(['provider', 'listing'])
  })

  it('does not merge Alpaca sizing conditions into shared quantity input', () => {
    const quantity = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'quantity')
    const notional = TradingActionBlock.subBlocks.find((subBlock) => subBlock.id === 'notional')

    expect(quantity?.condition).toEqual({ field: 'provider', value: ['alpaca', 'tradier'] })
    expect(notional?.condition).toEqual(
      expect.objectContaining({
        field: 'orderSizingMode',
        value: 'notional',
      })
    )
  })

  it('serializes trading action sizing through the selected provider only', () => {
    const params = TradingActionBlock.tools.config!.params!({
      portfolioIdentity: {
        providerId: 'tradier',
        credentialId: 'credential-1',
        credentialServiceId: 'tradier-live',
        accountId: 'ACC-1',
      },
      side: 'buy',
      listing: { listing_type: 'default', listing_id: 'AAPL', base_id: '', quote_id: '' },
      quantity: '2',
      orderSizingMode: 'notional',
      notional: '100',
    } as any)

    expect(params).toMatchObject({ quantity: 2 })
    expect(params).not.toHaveProperty('orderSizingMode')
    expect(params).not.toHaveProperty('notional')
  })
})
