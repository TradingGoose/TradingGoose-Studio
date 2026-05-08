import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateInternalToken } from '@/lib/auth/internal'
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

  it('keeps quantity precedence when orderSizingMode is omitted', () => {
    const body = buildBody({
      quantity: 2,
      notional: 150,
    })

    expect(body).toHaveProperty('qty', '2')
    expect(body).not.toHaveProperty('notional')
  })

  it('records workspace order history without workflow identity', async () => {
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
    expect(body).not.toHaveProperty('workflowExecutionId')
    expect(generateInternalToken).toHaveBeenCalledWith('user-1')
  })

  it('logs failed order-history recording responses instead of treating fetch completion as success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    }) as unknown as typeof fetch

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

    const processed = await tradingActionTool.postProcess?.(
      result,
      {
        ...baseParams,
        _context: {
          submissionSource: 'manual',
          userId: 'user-1',
          workspaceId: 'workspace-1',
        },
      } as any,
      vi.fn()
    )

    expect(processed).toBe(result)
  })

  it('maps explicit workflow log context to order log id', async () => {
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
          submissionSource: 'workflow',
          userId: 'user-1',
          workflowLogId: 'log-1',
          workspaceId: 'workspace-1',
        },
      } as any,
      vi.fn()
    )

    const body = JSON.parse(String(vi.mocked(global.fetch).mock.calls[0]![1]?.body))

    expect(body).toMatchObject({
      submissionSource: 'workflow',
      logId: 'log-1',
    })
  })
})
