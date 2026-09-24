/**
 * @vitest-environment node
 */

import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ROBINHOOD_MCP_URL } from '@/providers/trading/robinhood/config'
import type { TradingOrderHistoryRecord, TradingOrderInput } from '@/providers/trading/types'
import {
  normalizeRobinhoodOrder,
  robinhoodOrderDetailRequest,
  submitRobinhoodOrder,
} from './orders'
import { getRobinhoodTradingAccountSnapshot, getRobinhoodTradingAccounts } from './portfolio'

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
  transport: vi.fn(),
  listing: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    connect = sdk.connect
    callTool = sdk.callTool
    close = sdk.close
  },
}))
vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', async (original) => ({
  ...(await original<typeof import('@modelcontextprotocol/sdk/client/streamableHttp.js')>()),
  StreamableHTTPClientTransport: sdk.transport,
}))
vi.mock('@/providers/trading/listing-resolution', () => ({
  resolveTradingListingIdentity: sdk.listing,
}))

const envelope = (data: unknown) => ({ content: [], structuredContent: { data } })
const context = {
  providerId: 'robinhood',
  credentialId: 'same-oauth-credential',
  tokenAccountId: 'oauth-account',
  serviceId: 'robinhood',
  environment: 'live' as const,
  accessToken: 'token',
  accountId: 'AGENT-1234',
}
const portfolio = {
  total_value: '1300.50',
  equity_value: '900',
  cash: '300.50',
  currency: 'USD',
  buying_power: { buying_power: '600' },
}
const rawAccount = (account_number: string, overrides: Record<string, unknown> = {}) => ({
  account_number,
  agentic_allowed: true,
  type: 'cash',
  state: 'active',
  deactivated: false,
  permanently_deactivated: false,
  ...overrides,
})
const order: TradingOrderInput = {
  base: 'AAPL',
  quote: 'USD',
  assetClass: 'stock',
  side: 'buy',
  quantity: 2,
  orderSizingMode: 'quantity',
  orderType: 'market',
  timeInForce: 'day',
  accountId: context.accountId,
  accessToken: context.accessToken,
  environment: 'live',
  clientOrderId: 'tg-stable-order',
}
const brokerOrder = {
  id: 'broker-order',
  symbol: 'AAPL',
  side: 'buy',
  state: 'confirmed',
  type: 'market',
  quantity: '2',
  cumulative_quantity: '0.5',
  average_price: '123.45',
  time_in_force: 'gfd',
  dollar_based_amount: null,
  created_at: '2026-09-18T14:00:00Z',
}
const toolNames = () => sdk.callTool.mock.calls.map(([request]) => request.name)
const placements = () =>
  sdk.callTool.mock.calls.filter(([request]) => request.name === 'place_equity_order')

beforeEach(() => {
  vi.resetAllMocks()
  sdk.connect.mockResolvedValue(undefined)
  sdk.close.mockResolvedValue(undefined)
  sdk.listing.mockImplementation(async ({ listing }) => listing)
  sdk.callTool.mockImplementation(async ({ name, arguments: args }) =>
    name === 'review_equity_order'
      ? envelope({ ...args, order_checks: {} })
      : envelope({
          order: {
            ...brokerOrder,
            ...args,
            symbol: '',
            ...(args.dollar_amount
              ? {
                  quantity: null,
                  dollar_based_amount: { amount: args.dollar_amount, currency_code: 'USD' },
                }
              : {}),
          },
        })
  )
})

describe('Robinhood trading accounts and portfolio', () => {
  it.each([null, []])('returns no accounts for an empty account response: %j', async (accounts) => {
    sdk.callTool.mockResolvedValue(envelope({ accounts }))
    await expect(getRobinhoodTradingAccounts(context)).resolves.toEqual([])
    expect(toolNames()).toEqual(['get_accounts'])
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it('offers only Agentic-enabled accounts while preserving the shared OAuth credential', async () => {
    sdk.callTool.mockResolvedValue(
      envelope({
        accounts: [
          rawAccount('PERSONAL', { agentic_allowed: false }),
          null,
          rawAccount('AGENT-1234', { type: 'margin', nickname: 'Agentic' }),
          rawAccount('AGENT-5678', { type: 'limited_margin', deactivated: true }),
          rawAccount('AGENT-9999', {
            state: 'deactivated',
            deactivated: true,
            permanently_deactivated: true,
          }),
        ],
      })
    )
    const accounts = await getRobinhoodTradingAccounts(context)
    expect(accounts).toHaveLength(3)
    expect(accounts[0]).toMatchObject({
      accountId: 'AGENT-1234',
      credentialId: context.credentialId,
      serviceId: 'robinhood',
      accountName: 'Agentic',
      accountType: 'margin',
      accountStatus: 'active',
    })
    expect(accounts[1]).toMatchObject({
      accountId: 'AGENT-5678',
      accountName: 'Agentic • 5678',
      accountType: 'limited_margin',
      accountStatus: 'restricted',
    })
    expect(accounts[2]).toMatchObject({
      accountId: 'AGENT-9999',
      accountType: 'cash',
      accountStatus: 'closed',
    })
    expect(sdk.transport).toHaveBeenCalledWith(
      new URL(ROBINHOOD_MCP_URL),
      expect.objectContaining({
        requestInit: { headers: { Authorization: 'Bearer token' } },
      })
    )
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it('paginates equity holdings while preserving account-wide totals and unavailable valuations', async () => {
    sdk.callTool
      .mockResolvedValueOnce(envelope(portfolio))
      .mockResolvedValueOnce(
        envelope({
          positions: [null, { symbol: 'AAPL', quantity: '2', average_buy_price: '100' }],
          next: 'https://api.robinhood.com/positions/?cursor=page2',
        })
      )
      .mockResolvedValueOnce(
        envelope({ positions: null, next: 'https://api.robinhood.com/positions/?cursor=page3' })
      )
      .mockResolvedValueOnce(
        envelope({
          positions: [{ symbol: 'SPY', quantity: '0.5', average_buy_price: null }],
          next: null,
        })
      )
    const snapshot = await getRobinhoodTradingAccountSnapshot(context)
    expect(snapshot).toMatchObject({
      accountId: context.accountId,
      accountName: 'Agentic • 1234',
      credentialId: context.credentialId,
      environment: 'live',
      summary: {
        totalPortfolioValue: 1300.5,
        totalCashValue: 300.5,
        totalHoldingsValue: 900,
        buyingPower: 600,
      },
      cashBalances: [{ amount: 300.5 }],
    })
    expect(snapshot.positions).toHaveLength(2)
    expect(snapshot.positions[0]).toMatchObject({ quantity: 2, averagePrice: 100, costBasis: 200 })
    expect(snapshot.positions[1].averagePrice).toBeUndefined()
    for (const position of snapshot.positions) {
      expect(position.marketPrice).toBeUndefined()
      expect(position.marketValue).toBeUndefined()
      expect(position.unrealizedPnl).toBeUndefined()
    }
    expect(sdk.callTool.mock.calls.map(([request]) => request.arguments)).toEqual([
      { account_number: context.accountId },
      { account_number: context.accountId },
      { account_number: context.accountId, cursor: 'page2' },
      { account_number: context.accountId, cursor: 'page3' },
    ])
    expect(sdk.listing).toHaveBeenCalledTimes(2)
  })

  it.each([null, '', '   ', 'not-a-number'])(
    'rejects invalid portfolio value %j instead of coercing to zero',
    async (value) => {
      sdk.callTool.mockResolvedValue(envelope({ ...portfolio, total_value: value }))
      await expect(getRobinhoodTradingAccountSnapshot(context)).rejects.toMatchObject({
        status: 502,
      })
      expect(toolNames()).toEqual(['get_portfolio'])
      expect(sdk.close).toHaveBeenCalledOnce()
    }
  )

  it.each([
    { positions: null, buying_power: portfolio.buying_power },
    { positions: [], buying_power: null },
    { positions: null, buying_power: null },
  ])(
    'preserves balances with nullable portfolio fields: %j',
    async ({ positions, buying_power }) => {
      sdk.callTool
        .mockResolvedValueOnce(
          envelope({
            ...portfolio,
            cash: '1000',
            total_value: '1000',
            equity_value: '0',
            buying_power,
          })
        )
        .mockResolvedValueOnce(envelope({ positions }))
      const snapshot = await getRobinhoodTradingAccountSnapshot(context)
      expect(snapshot.positions).toEqual([])
      expect(snapshot.cashBalances).toEqual([
        { currency: 'USD', currencySymbol: '$', amount: 1000 },
      ])
      expect(snapshot.summary).toMatchObject({
        totalPortfolioValue: 1000,
        totalCashValue: 1000,
        totalHoldingsValue: 0,
        equity: 1000,
      })
      expect(snapshot.summary.buyingPower).toBe(buying_power ? 600 : undefined)
      expect(sdk.close).toHaveBeenCalledOnce()
    }
  )

  it('rejects repeated pagination cursors instead of returning a truncated or duplicated portfolio', async () => {
    const page = { positions: [], next: 'https://api.robinhood.com/positions/?cursor=repeated' }
    sdk.callTool.mockResolvedValueOnce(envelope(portfolio)).mockResolvedValue(envelope(page))
    await expect(getRobinhoodTradingAccountSnapshot(context)).rejects.toMatchObject({ status: 502 })
    expect(toolNames()).toEqual(['get_portfolio', 'get_equity_positions', 'get_equity_positions'])
    expect(sdk.close).toHaveBeenCalledOnce()
  })
})

describe('Robinhood order review and placement', () => {
  it('preserves the broker ID when a placement acknowledgement has an empty symbol', async () => {
    // Shape captured live: https://nexustrade.io/blog/robinhood-agentic-trading-mcp-review-20260708
    const result = await submitRobinhoodOrder(order)
    expect(normalizeRobinhoodOrder(result)).toMatchObject({
      id: brokerOrder.id,
      symbol: order.base,
      status: 'accepted',
      raw: { id: brokerOrder.id, quantity: String(order.quantity) },
    })
    expect(toolNames()).toEqual(['place_equity_order'])
  })

  it.each([
    { id: undefined },
    { id: '' },
    { state: undefined },
    { symbol: 'MSFT' },
    { side: 'sell' },
    { ref_id: 'different-order' },
    { dollar_based_amount: { amount: '', currency_code: 'USD' } },
    { dollar_based_amount: { amount: '25.50', currency_code: 'EUR' } },
    { dollar_based_amount: '25.50' },
  ])('rejects an invalid or contradictory placement acknowledgement %j', async (override) => {
    sdk.callTool.mockResolvedValueOnce(envelope({ order: { ...brokerOrder, ...override } }))
    await expect(submitRobinhoodOrder(order)).rejects.toMatchObject({ submissionUnknown: true })
    expect(placements()).toHaveLength(1)
  })

  it('returns review warnings during preview without placing an order', async () => {
    sdk.callTool.mockImplementation(async ({ arguments: args }) =>
      envelope({ ...args, order_checks: { warning: 'Insufficient buying power' } })
    )
    const result = await submitRobinhoodOrder({ ...order, preview: true })
    expect(normalizeRobinhoodOrder(result)).toMatchObject({
      status: 'preview',
      symbol: 'AAPL',
      side: 'buy',
    })
    expect(toolNames()).toEqual(['review_equity_order'])
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it('rejects a mismatched preview echo without placing an order', async () => {
    sdk.callTool.mockImplementation(async ({ arguments: args }) =>
      envelope({ ...args, symbol: 'MSFT', order_checks: {} })
    )
    await expect(submitRobinhoodOrder({ ...order, preview: true })).rejects.toMatchObject({
      status: 502,
      submissionUnknown: false,
    })
    expect(toolNames()).toEqual(['review_equity_order'])
    expect(sdk.close).toHaveBeenCalledOnce()
  })

  it.each([
    { input: {}, expected: { type: 'market', quantity: '2', time_in_force: 'gfd' } },
    {
      input: { orderType: 'limit', limitPrice: 120, timeInForce: 'gtc' },
      expected: { type: 'limit', limit_price: '120', time_in_force: 'gtc' },
    },
    {
      input: { orderType: 'stop', stopPrice: 90 },
      expected: { type: 'stop_market', stop_price: '90' },
    },
    {
      input: { orderType: 'stop_limit', stopPrice: 90, limitPrice: 89 },
      expected: { type: 'stop_limit', stop_price: '90', limit_price: '89' },
    },
    {
      input: { orderSizingMode: 'notional', quantity: undefined, notional: 25.5 },
      expected: { dollar_amount: '25.5' },
    },
    { input: { quantity: 0.123456 }, expected: { quantity: '0.123456' } },
  ])('maps supported sizing/order fields %j', async ({ input, expected }) => {
    const result = await submitRobinhoodOrder({ ...order, ...input } as TradingOrderInput)
    expect(toolNames()).toEqual(['place_equity_order'])
    const args = placements()[0][0].arguments
    expect(args).toMatchObject({
      ...expected,
      account_number: context.accountId,
      symbol: 'AAPL',
      side: 'buy',
      market_hours: 'regular_hours',
    })
    expect(args).not.toHaveProperty(
      input.orderSizingMode === 'notional' ? 'quantity' : 'dollar_amount'
    )
    expect(normalizeRobinhoodOrder(result)).toMatchObject({ id: 'broker-order', filledQty: 0.5 })
    if (input.orderSizingMode === 'notional') {
      expect(normalizeRobinhoodOrder(result)).toMatchObject({ quantity: null, notional: 25.5 })
    }
  })

  it.each([
    { environment: 'paper' },
    { quantity: 0 },
    { quantity: 0.1234567 },
    { quantity: 0.5, timeInForce: 'gtc' },
    { orderSizingMode: 'notional', notional: 20, orderType: 'limit', limitPrice: 10 },
    { orderType: 'trailing_stop' },
    { orderType: 'limit' },
  ])('rejects unsupported request before connecting %j', async (input) => {
    await expect(
      submitRobinhoodOrder({ ...order, ...input } as TradingOrderInput)
    ).rejects.toThrow()
    expect(sdk.connect).not.toHaveBeenCalled()
    expect(sdk.callTool).not.toHaveBeenCalled()
  })

  it('uses a stable UUID ref_id bound to account and canonical client order ID', async () => {
    await submitRobinhoodOrder(order)
    await submitRobinhoodOrder(order)
    await submitRobinhoodOrder({ ...order, accountId: 'OTHER-ACCOUNT' })
    await submitRobinhoodOrder({ ...order, clientOrderId: 'tg-other-order' })
    const refs = placements().map(([request]) => request.arguments.ref_id)
    expect(refs[0]).toMatch(/^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/)
    expect(refs[0]).toBe(refs[1])
    expect(new Set(refs).size).toBe(3)
  })

  it.each(['timeout', 'tool-error'])(
    'classifies %s placement failures and closes its client',
    async (failure) => {
      sdk.callTool.mockImplementation(async () => {
        if (failure === 'timeout')
          throw new McpError(ErrorCode.RequestTimeout, 'private upstream body')
        return { isError: true, content: [{ type: 'text', text: 'private upstream body' }] }
      })
      await expect(submitRobinhoodOrder(order)).rejects.toMatchObject({
        status: failure === 'timeout' ? 504 : 502,
        submissionUnknown: failure === 'timeout',
        message: expect.not.stringContaining('private upstream body'),
      })
      expect(toolNames()).toEqual(['place_equity_order'])
      expect(sdk.connect).toHaveBeenCalledOnce()
      expect(sdk.close).toHaveBeenCalledOnce()
    }
  )
})

describe('Robinhood persisted order detail', () => {
  it('queries the persisted account and unwraps data.orders before canonical normalization', async () => {
    const history: TradingOrderHistoryRecord = {
      id: 'app-order',
      workspaceId: 'workspace',
      provider: 'robinhood',
      submissionSource: 'manual',
      request: { accountId: 'PERSISTED-ACCOUNT', clientOrderId: order.clientOrderId },
      response: { orderId: brokerOrder.id },
    }
    sdk.callTool.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            data: {
              orders: [
                {
                  ...brokerOrder,
                  type: 'market',
                  trigger: 'stop',
                  dollar_based_amount: { amount: '5.04', currency_code: 'USD' },
                },
              ],
            },
          }),
        },
      ],
    })
    const result = await robinhoodOrderDetailRequest(history, {
      accessToken: 'token',
      accountId: 'OTHER-ACCOUNT',
      orderId: history.id,
    })
    expect(sdk.callTool.mock.calls[0][0]).toEqual({
      name: 'get_equity_orders',
      arguments: { account_number: 'PERSISTED-ACCOUNT', order_id: 'broker-order' },
    })
    expect(result.orderDetail).toMatchObject({
      appOrderId: 'app-order',
      providerOrderId: 'broker-order',
      clientOrderId: order.clientOrderId,
      orderType: 'stop',
      timeInForce: 'day',
      quantity: 2,
      filledQuantity: 0.5,
      remainingQuantity: 1.5,
      averageFillPrice: 123.45,
      notional: 5.04,
      raw: { quantity: '2', dollar_based_amount: { amount: '5.04', currency_code: 'USD' } },
    })
    expect(sdk.close).toHaveBeenCalledOnce()
  })
})
