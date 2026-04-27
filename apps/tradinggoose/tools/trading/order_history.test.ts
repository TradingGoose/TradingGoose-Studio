import { describe, expect, it } from 'vitest'
import { orderHistoryTool } from '@/tools/trading/order_history'

const requestUrlBuilder = orderHistoryTool.request?.url
if (typeof requestUrlBuilder !== 'function') {
  throw new Error('orderHistoryTool request URL builder is not configured')
}

describe('orderHistoryTool request scope', () => {
  it('sends workspace scope from normalized execution context', () => {
    const url = requestUrlBuilder({
      startDate: '2026-04-23T00:00:00.000Z',
      endDate: '2026-04-24T00:00:00.000Z',
      _context: {
        workflowId: 'workflow-1',
        workspaceId: 'workspace-1',
      },
    } as any)

    expect(url).toBe(
      '/api/tools/trading/order-history?workspaceId=workspace-1&startDate=2026-04-23T00%3A00%3A00.000Z&endDate=2026-04-24T00%3A00%3A00.000Z&workflowId=workflow-1'
    )
  })

  it('keeps explicit workflow filters separate from workspace scope', () => {
    const url = requestUrlBuilder({
      startDate: '2026-04-23T00:00:00.000Z',
      endDate: '2026-04-24T00:00:00.000Z',
      workflowId: 'filtered-workflow',
      _context: {
        workflowId: 'current-workflow',
        workspaceId: 'workspace-1',
      },
    } as any)

    expect(new URL(url, 'http://localhost').searchParams.get('workflowId')).toBe(
      'filtered-workflow'
    )
    expect(new URL(url, 'http://localhost').searchParams.get('workspaceId')).toBe('workspace-1')
  })

  it('rejects missing workspace scope before building a request URL', () => {
    expect(() =>
      requestUrlBuilder({
        startDate: '2026-04-23T00:00:00.000Z',
        endDate: '2026-04-24T00:00:00.000Z',
        _context: { workflowId: 'workflow-1' },
      } as any)
    ).toThrow('trading_order_history requires workspace execution context')
  })
})
