import { beforeEach, describe, expect, it, vi } from 'vitest'
import { tradingActionTool } from '@/tools/trading/action'

vi.mock('@/lib/auth/internal', () => ({
  generateInternalToken: vi.fn().mockResolvedValue('internal-token-1'),
}))

vi.mock('@/lib/urls/utils', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3000'),
}))

const baseParams = {
  provider: 'alpaca' as const,
  listing: {
    listing_type: 'default' as const,
    listing_id: 'AAPL',
    base_id: '',
    quote_id: '',
  },
  side: 'buy' as const,
  orderType: 'market' as const,
  timeInForce: 'day' as const,
  accessToken: 'test-token',
}

const requestBodyBuilder = tradingActionTool.request?.body
if (!requestBodyBuilder) {
  throw new Error('tradingActionTool request body builder is not configured')
}

const buildBody = (overrides: Record<string, unknown> = {}) =>
  requestBodyBuilder({
    ...baseParams,
    ...overrides,
  } as any) as Record<string, any>

describe('tradingActionTool sizing normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps notional when orderSizingMode=notional and stale quantity is present', () => {
    const body = buildBody({
      orderSizingMode: 'notional',
      quantity: 2,
      notional: 150,
    })

    expect(body).toMatchObject({
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      notional: 150,
    })
    expect(body).not.toHaveProperty('qty')
  })

  it('keeps quantity when orderSizingMode=quantity and notional is present', () => {
    const body = buildBody({
      orderSizingMode: 'quantity',
      quantity: 2,
      notional: 150,
    })

    expect(body).toMatchObject({
      side: 'buy',
      type: 'market',
      time_in_force: 'day',
      qty: '2',
    })
    expect(body).not.toHaveProperty('notional')
  })

  it('supports case-insensitive orderSizingMode values', () => {
    const body = buildBody({
      orderSizingMode: 'NoTiOnAl',
      quantity: 2,
      notional: 150,
    })

    expect(body).toHaveProperty('notional', 150)
    expect(body).not.toHaveProperty('qty')
  })

  it('keeps legacy quantity precedence when orderSizingMode is omitted', () => {
    const body = buildBody({
      quantity: 2,
      notional: 150,
    })

    expect(body).toHaveProperty('qty', '2')
    expect(body).not.toHaveProperty('notional')
  })

  it('records workflow provenance only from normalized execution context', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch

    await tradingActionTool.postProcess?.(
      {
        success: true,
        output: {
          order: {
            id: 'provider-order-1',
            raw: { id: 'provider-order-1', status: 'filled' },
          },
          provider: 'alpaca',
          summary: 'Order submitted',
        },
      },
      {
        ...baseParams,
        _context: {
          submissionSource: 'workflow',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
        _workflowId: 'legacy-workflow-1',
      } as any,
      vi.fn()
    )

    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/tools/trading/order-history',
      expect.objectContaining({ method: 'POST' })
    )
    const [, options] = vi.mocked(global.fetch).mock.calls[0]!
    const body = JSON.parse(String(options?.body))
    expect(body).toMatchObject({
      provider: 'alpaca',
      submissionSource: 'workflow',
      workspaceId: 'workspace-1',
    })
    expect(body).not.toHaveProperty('workflowId')
  })

  it('infers workflow submission source only when workflowLogId is present', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true }) as typeof fetch

    const result = {
      success: true,
      output: {
        order: {
          id: 'provider-order-1',
          raw: { id: 'provider-order-1', status: 'filled' },
        },
        provider: 'alpaca',
        summary: 'Order submitted',
      },
    }

    await tradingActionTool.postProcess?.(
      result,
      {
        ...baseParams,
        _context: {
          userId: 'user-1',
          workspaceId: 'workspace-1',
          workflowLogId: 'log-1',
        },
      } as any,
      vi.fn()
    )
    await tradingActionTool.postProcess?.(
      result,
      {
        ...baseParams,
        _context: {
          executionId: 'execution-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      } as any,
      vi.fn()
    )

    const firstBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]![1]?.body))
    const secondBody = JSON.parse(String(vi.mocked(global.fetch).mock.calls[1]![1]?.body))

    expect(firstBody).toMatchObject({
      submissionSource: 'workflow',
      workflowLogId: 'log-1',
    })
    expect(secondBody).toMatchObject({
      submissionSource: 'manual',
      workflowExecutionId: 'execution-1',
    })
    expect(secondBody).not.toHaveProperty('workflowLogId')
  })
})
