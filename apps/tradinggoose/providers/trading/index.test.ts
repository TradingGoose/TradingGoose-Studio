/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeTradingProviderRequest } from '@/providers/trading'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import { robinhoodProvider } from '@/providers/trading/robinhood'
import type { TradingOrderRequest } from '@/providers/trading/types'

const request: TradingOrderRequest = {
  kind: 'order',
  base: 'AAPL',
  assetClass: 'stock',
  side: 'buy',
  quantity: 2,
  orderSizingMode: 'quantity',
  orderType: 'market',
  timeInForce: 'day',
  accessToken: 'test-token',
  accountId: 'account-1',
  clientOrderId: 'client-order-1',
}

describe('Trading order submission dispatch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('executes an Alpaca JSON order and returns its raw broker response', async () => {
    const response = { id: 'alpaca-order-1', status: 'accepted' }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)))

    await expect(executeTradingProviderRequest('alpaca', request)).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.alpaca.markets/v2/orders')
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    })
    expect(JSON.parse(init.body)).toMatchObject({
      symbol: 'AAPL',
      qty: '2',
      client_order_id: 'client-order-1',
    })
  })

  it('preserves Tradier form encoding and the selected brokerage account', async () => {
    const response = { order: { id: 'tradier-order-1', status: 'ok' } }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response)))

    await expect(executeTradingProviderRequest('tradier', request)).resolves.toEqual(response)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.tradier.com/v1/accounts/account-1/orders')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    })
    const body = new URLSearchParams(init.body)
    expect(body.get('symbol')).toBe('AAPL')
    expect(body.get('quantity')).toBe('2')
    expect(body.get('tag')).toBe('client-order-1')
  })

  it('accepts asynchronous adapter results without imposing another HTTP request', async () => {
    const response = { id: 'async-order-1', status: 'submitted' }
    const submit = vi.spyOn(robinhoodProvider, 'submitOrder').mockImplementation(async () => {
      await Promise.resolve()
      return response
    })

    await expect(executeTradingProviderRequest('robinhood', request)).resolves.toBe(response)

    expect(submit).toHaveBeenCalledWith(request)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('propagates broker rejection without retrying order submission', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rejected' }), { status: 422 })
    )

    await expect(executeTradingProviderRequest('alpaca', request)).rejects.toMatchObject({
      name: TradingBrokerRequestError.name,
      status: 422,
      providerId: 'alpaca',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
