import type {
  TradingOrderDetailInput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
  TradingRequestConfig,
} from '@/providers/trading/types'
import type { TradingOrderDetailOutput } from '@/tools/trading/types'

const firstDefinedString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

export const resolveRobinhoodOrderDetailProviderOrderId = (
  historyRecord: TradingOrderHistoryRecord
): string | null =>
  firstDefinedString(
    historyRecord.response?.orderId,
    historyRecord.normalizedOrder?.id,
    historyRecord.response?.raw?.id,
    historyRecord.response?.raw?.order?.id
  )

export const buildRobinhoodOrderDetailRequest = (
  providerOrderId: string,
  _historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): TradingRequestConfig => {
  if (!params.accessToken) {
    throw new Error('Robinhood access token is required to fetch order details.')
  }

  return {
    url: `https://api.robinhood.com/orders/${encodeURIComponent(providerOrderId)}/`,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: 'application/json',
    },
  }
}

export const normalizeRobinhoodOrderDetail = (
  appOrderId: string,
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  rawOrder: Record<string, any>
): TradingOrderDetailOutput => ({
  appOrderId,
  provider: 'robinhood',
  providerOrderId,
  environment: historyRecord.environment ?? null,
  clientOrderId: firstDefinedString(
    rawOrder.client_order_id,
    rawOrder.clientOrderId,
    rawOrder.ref_id
  ),
  createdAt: firstDefinedString(rawOrder.created_at, rawOrder.createdAt),
  updatedAt: firstDefinedString(rawOrder.updated_at, rawOrder.updatedAt),
  submittedAt: firstDefinedString(rawOrder.created_at, rawOrder.submitted_at),
  filledAt: firstDefinedString(
    rawOrder.executed_at,
    rawOrder.last_transaction_at,
    rawOrder.filled_at
  ),
  canceledAt: firstDefinedString(rawOrder.cancelled_at, rawOrder.canceled_at),
  expiredAt: firstDefinedString(rawOrder.expired_at),
  symbol: firstDefinedString(rawOrder.symbol),
  side: firstDefinedString(rawOrder.side),
  status: firstDefinedString(rawOrder.state, rawOrder.status),
  orderType: firstDefinedString(rawOrder.type, rawOrder.order_type),
  timeInForce: firstDefinedString(rawOrder.time_in_force, rawOrder.timeInForce),
  quantity: rawOrder.quantity ?? null,
  filledQuantity: rawOrder.cumulative_quantity ?? rawOrder.filled_quantity ?? null,
  remainingQuantity: rawOrder.remaining_quantity ?? null,
  notional: rawOrder.notional ?? rawOrder.dollar_based_amount ?? null,
  limitPrice: rawOrder.price ?? rawOrder.limit_price ?? null,
  stopPrice: rawOrder.stop_price ?? null,
  averageFillPrice: rawOrder.average_price ?? rawOrder.average_fill_price ?? null,
  raw: rawOrder,
})

const parseErrorPayload = async (response: Response): Promise<unknown> => {
  try {
    return await response.json()
  } catch (_jsonError) {
    try {
      return await response.text()
    } catch (_textError) {
      return null
    }
  }
}

const toRecord = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') {
    return value as Record<string, any>
  }
  return { value }
}

export const robinhoodOrderDetailRequest = async (
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> => {
  const providerOrderId = resolveRobinhoodOrderDetailProviderOrderId(historyRecord)
  if (!providerOrderId) {
    throw new Error('Unable to resolve Robinhood provider order ID from order history record.')
  }

  const request = buildRobinhoodOrderDetailRequest(providerOrderId, historyRecord, params)
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
  })

  if (!response.ok) {
    const details = await parseErrorPayload(response)
    throw Object.assign(new Error('Failed to fetch Robinhood order detail.'), {
      status: response.status,
      details,
      providerOrderId,
    })
  }

  const rawOrder = toRecord(await response.json().catch(() => ({})))

  return {
    providerOrderId,
    orderDetail: normalizeRobinhoodOrderDetail(
      historyRecord.id,
      providerOrderId,
      historyRecord,
      rawOrder
    ),
  }
}
