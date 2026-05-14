import { describe, expect, it } from 'vitest'
import { orderHistoryTool } from '@/tools/trading/order_history'

const requestUrlBuilder = orderHistoryTool.request?.url
if (typeof requestUrlBuilder !== 'function') {
  throw new Error('orderHistoryTool request URL builder is not configured')
}

describe('orderHistoryTool request scope', () => {
  it('declares workspace read execution policy on the tool config', () => {
    expect(orderHistoryTool.execution).toEqual({
      workspace: { required: true, access: 'read' },
    })
  })

  it('sends workspace scope from normalized execution context', () => {
    const url = requestUrlBuilder({
      startDate: '2026-04-23T00:00:00.000Z',
      endDate: '2026-04-24T00:00:00.000Z',
      _context: {
        workspaceId: 'workspace-1',
      },
    } as any)

    expect(url).toBe(
      '/api/tools/trading/order-history?workspaceId=workspace-1&startDate=2026-04-23T00%3A00%3A00.000Z&endDate=2026-04-24T00%3A00%3A00.000Z'
    )
  })

  it('rejects missing workspace scope before building a request URL', () => {
    expect(() =>
      requestUrlBuilder({
        startDate: '2026-04-23T00:00:00.000Z',
        endDate: '2026-04-24T00:00:00.000Z',
        _context: {},
      } as any)
    ).toThrow('trading_order_history requires workspace execution context')
  })
})
