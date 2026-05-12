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
})
