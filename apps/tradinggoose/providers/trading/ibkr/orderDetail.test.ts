import { describe, expect, it } from 'vitest'
import {
  findIbkrOrderById,
  normalizeIbkrOrderDetail,
  resolveIbkrOrderDetailProviderOrderId,
} from '@/providers/trading/ibkr/orderDetail'

const historyRecord: any = {
  id: 'app-order-1',
  workspaceId: 'ws-1',
  provider: 'ibkr',
  environment: 'paper',
  submissionSource: 'manual',
  request: { accountId: 'DU123456' },
  response: {
    orderId: '12345',
    clientOrderId: 'tg-client-1',
  },
  normalizedOrder: {
    id: '12345',
  },
}

describe('resolveIbkrOrderDetailProviderOrderId', () => {
  it('resolves from response orderId', () => {
    expect(resolveIbkrOrderDetailProviderOrderId(historyRecord)).toBe('12345')
  })
})

describe('findIbkrOrderById', () => {
  it('finds an order by provider order id', () => {
    const orders = {
      orders: [
        { order_id: 999, order_ref: 'other' },
        { order_id: 12345, order_ref: 'tg-client-1' },
      ],
    }

    const found = findIbkrOrderById(orders, '12345')
    expect(found?.order_id).toBe(12345)
  })

  it('finds an order by client order ref when ids do not match', () => {
    const orders = {
      orders: [{ order_id: 88888, order_ref: 'tg-client-1' }],
    }

    const found = findIbkrOrderById(orders, '12345', 'tg-client-1')
    expect(found?.order_id).toBe(88888)
  })

  it('returns null when no order matches', () => {
    const orders = { orders: [{ order_id: 1, order_ref: 'x' }] }
    expect(findIbkrOrderById(orders, '99999')).toBeNull()
  })

  it('handles nested order arrays', () => {
    const orders = [{ orders: [{ order_id: 12345 }] }]
    expect(findIbkrOrderById(orders, '12345')?.order_id).toBe(12345)
  })
})

describe('normalizeIbkrOrderDetail', () => {
  it('normalizes a filled order', () => {
    const detail = normalizeIbkrOrderDetail('app-order-1', '12345', historyRecord, {
      order_id: 12345,
      order_ref: 'tg-client-1',
      ticker: 'AAPL',
      side: 'BUY',
      status: 'FILLED',
      order_type: 'LMT',
      tif: 'DAY',
      quantity: 10,
      filled: 10,
      lmt_price: 250,
      avg_price: 249.5,
      submit_time: 1785600000,
      last_update_time: 1785603600,
    })

    expect(detail).toMatchObject({
      appOrderId: 'app-order-1',
      provider: 'ibkr',
      providerOrderId: '12345',
      environment: 'paper',
      clientOrderId: 'tg-client-1',
      symbol: 'AAPL',
      side: 'BUY',
      status: 'FILLED',
      orderType: 'LMT',
      quantity: 10,
      filledQuantity: 10,
      remainingQuantity: 0,
      limitPrice: 250,
      averageFillPrice: 249.5,
    })
    expect(detail.createdAt).toBeTruthy()
    expect(detail.updatedAt).toBeTruthy()
  })

  it('computes remaining quantity for partial fills', () => {
    const detail = normalizeIbkrOrderDetail('app-order-1', '12345', historyRecord, {
      order_id: 12345,
      quantity: 10,
      filled: 4,
      status: 'PARTIALLY_FILLED',
    })

    expect(detail.remainingQuantity).toBe(6)
  })
})
