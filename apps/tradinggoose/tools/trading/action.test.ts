import { describe, expect, it } from 'vitest'
import { tradingActionTool } from '@/tools/trading/action'

const baseParams = {
  provider: 'alpaca' as const,
  listing: 'AAPL',
  side: 'buy' as const,
  orderType: 'market' as const,
  timeInForce: 'day' as const,
  environment: 'paper' as const,
  accessToken: 'test-token',
}

const buildBody = (overrides: Record<string, unknown> = {}) =>
  tradingActionTool.request.body({
    ...baseParams,
    ...overrides,
  } as any) as Record<string, any>

describe('tradingActionTool sizing normalization', () => {
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
})
