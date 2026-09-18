import { v5 as uuidv5 } from 'uuid'
import { z } from 'zod'
import { ListingResolvedSchema } from '@/lib/listing/identity'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import { robinhoodNumber, withRobinhoodTradingClient } from '@/providers/trading/robinhood/client'
import {
  ROBINHOOD_MCP_URL,
  robinhoodTradingProviderConfig,
} from '@/providers/trading/robinhood/config'
import type {
  TradingOrder,
  TradingOrderDetailInput,
  TradingOrderDetailOutput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingOrderInput,
} from '@/providers/trading/types'
import { listingIdentityToTradingSymbol } from '@/providers/trading/utils'

// MCP tool schemas: alphillips-lab/robinhoodmcp, src/robinhoodmcp/client.py.
// Review/place envelopes: abiemann/RobinhoodEquityTradingAgent, connector_contract.py/order_intents.py.
const orderSchema = z.object({
  id: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  state: z.string().min(1),
  type: z.string().optional(),
  trigger: z.string().optional(),
  ref_id: z.string().optional(),
  quantity: robinhoodNumber.nullish(),
  cumulative_quantity: robinhoodNumber.nullish(),
  dollar_based_amount: z.object({ amount: robinhoodNumber }).nullish(),
  price: robinhoodNumber.nullish(),
  stop_price: robinhoodNumber.nullish(),
  average_price: robinhoodNumber.nullish(),
  time_in_force: z.string().optional(),
  created_at: z.string().optional(),
  last_transaction_at: z.string().nullish(),
})
const reviewSchema = z
  .object({
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    type: z.string(),
    order_checks: z.record(z.string(), z.unknown()),
  })
  .passthrough()

export async function submitRobinhoodOrder(params: TradingOrderInput): Promise<unknown> {
  if (params.environment !== 'live' || !params.accountId || !params.clientOrderId) {
    throw new Error('Robinhood requires a live Agentic account and a client order ID.')
  }
  const listing = ListingResolvedSchema.safeParse(params.listing)
  if (
    (params.quote && params.quote !== 'USD') ||
    (listing.success &&
      ((listing.data.quote && listing.data.quote !== 'USD') ||
        (listing.data.countryCode && listing.data.countryCode !== 'US')))
  ) {
    throw new Error('Robinhood equity orders require a US listing in USD.')
  }
  const orderType = params.orderType ?? 'market'
  const timeInForce = params.timeInForce ?? 'day'
  if (
    !['market', 'limit', 'stop', 'stop_limit'].includes(orderType) ||
    !['day', 'gtc'].includes(timeInForce)
  ) {
    throw new Error('Unsupported Robinhood order type or time in force.')
  }
  const notional = params.orderSizingMode === 'notional'
  const amount = notional ? params.notional : params.quantity
  if (
    !params.orderSizingMode ||
    amount == null ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    (notional && (orderType !== 'market' || timeInForce !== 'day')) ||
    (!notional &&
      !Number.isInteger(amount) &&
      (orderType !== 'market' || timeInForce !== 'day' || Number(amount.toFixed(6)) !== amount))
  ) {
    throw new Error(
      'Robinhood fractional shares and dollar sizing require a day market order; fractional precision is six decimals.'
    )
  }
  const args: Record<string, unknown> = {
    account_number: params.accountId,
    symbol: listingIdentityToTradingSymbol(robinhoodTradingProviderConfig, params),
    side: params.side,
    type: orderType === 'stop' ? 'stop_market' : orderType,
    time_in_force: timeInForce === 'day' ? 'gfd' : 'gtc',
    market_hours: 'regular_hours',
    [notional ? 'dollar_amount' : 'quantity']: String(amount),
  }
  for (const [field, value, needed] of [
    ['limit_price', params.limitPrice, orderType === 'limit' || orderType === 'stop_limit'],
    ['stop_price', params.stopPrice, orderType === 'stop' || orderType === 'stop_limit'],
  ] as const) {
    if (!needed) continue
    if (value == null || !Number.isFinite(value) || value <= 0)
      throw new Error(`Robinhood requires ${field}.`)
    args[field] = String(value)
  }
  // Adapt the canonical stable ID to Robinhood's UUID format; never regenerate on retry.
  const refId = uuidv5(`robinhood:${params.accountId}:${params.clientOrderId}`, uuidv5.URL)
  return withRobinhoodTradingClient(params.accessToken, async (call) => {
    const review = reviewSchema.parse(await call('review_equity_order', args))
    if (
      review.symbol !== args.symbol ||
      review.side !== args.side ||
      review.type !== args.type ||
      ['quantity', 'dollar_amount', 'limit_price', 'stop_price'].some(
        (key) => args[key] !== undefined && Number(review[key]) !== Number(args[key])
      )
    ) {
      throw new Error('Robinhood review does not match the requested order.')
    }
    if (params.preview) return { state: 'preview', symbol: args.symbol, side: args.side, review }
    if (Object.keys(review.order_checks).length) {
      throw new TradingBrokerRequestError({
        providerId: 'robinhood',
        url: ROBINHOOD_MCP_URL,
        status: 422,
        message:
          'Robinhood blocked this order during review. Resolve the account or order restrictions in Robinhood before retrying.',
        payload: { review },
      })
    }
    const data = await call('place_equity_order', { ...args, ref_id: refId })
    const order = orderSchema.parse(data.order)
    if (
      order.symbol !== args.symbol ||
      order.side !== args.side ||
      (order.ref_id && order.ref_id !== refId)
    ) {
      throw new Error('Robinhood returned a different order than requested.')
    }
    return data.order
  })
}

export function normalizeRobinhoodOrder(
  data: unknown
): TradingOrder & Partial<TradingOrderDetailOutput> {
  const preview = z
    .object({
      state: z.literal('preview'),
      symbol: z.string(),
      side: z.string(),
      review: reviewSchema,
    })
    .safeParse(data)
  if (preview.success)
    return { status: 'preview', symbol: preview.data.symbol, side: preview.data.side, raw: data }
  const order = orderSchema.parse(data)
  const statuses: Record<string, string> = {
    queued: 'pending',
    unconfirmed: 'pending',
    confirmed: 'accepted',
    cancelled: 'canceled',
    voided: 'canceled',
  }
  return {
    id: order.id,
    status: statuses[order.state] ?? order.state,
    createdAt: order.created_at,
    submittedAt: order.created_at,
    updatedAt: order.last_transaction_at,
    filledQty: order.cumulative_quantity ?? undefined,
    symbol: order.symbol,
    side: order.side,
    orderType:
      order.type === 'stop_market' || (order.type === 'market' && order.trigger === 'stop')
        ? 'stop'
        : order.type === 'limit' && order.trigger === 'stop'
          ? 'stop_limit'
          : order.type,
    timeInForce: order.time_in_force === 'gfd' ? 'day' : order.time_in_force,
    quantity: order.quantity,
    filledQuantity: order.cumulative_quantity,
    remainingQuantity:
      order.quantity == null || order.cumulative_quantity == null
        ? null
        : Math.max(0, order.quantity - order.cumulative_quantity),
    notional: order.dollar_based_amount?.amount,
    limitPrice: order.price,
    stopPrice: order.stop_price,
    averageFillPrice: order.average_price,
    raw: data,
  }
}

export async function robinhoodOrderDetailRequest(
  history: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> {
  const accountId = z.string().min(1).parse(history.request?.accountId)
  const providerOrderId = z
    .string()
    .min(1)
    .parse(history.normalizedOrder?.id ?? history.response?.orderId)
  return withRobinhoodTradingClient(params.accessToken, async (call) => {
    // Single-order mode still returns orders[] and enforces the owning account upstream.
    const data = await call('get_equity_orders', {
      account_number: accountId,
      order_id: providerOrderId,
    })
    const { orders } = z.object({ orders: z.array(orderSchema).max(1) }).parse(data)
    const order = orders.find((candidate) => candidate.id === providerOrderId)
    if (!order) throw new Error('Robinhood order was not found in the selected account.')
    return {
      providerOrderId,
      orderDetail: {
        ...normalizeRobinhoodOrder(order),
        appOrderId: history.id,
        provider: 'robinhood',
        providerOrderId,
        environment: 'live',
        clientOrderId: history.request?.clientOrderId,
        raw: (data.orders as unknown[])[0],
      },
    }
  })
}
