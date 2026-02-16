import { buildAlpacaAuthHeaders } from '@/providers/trading/alpaca/auth'
import type {
  TradingHoldingsInput,
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

export const resolveAlpacaOrderDetailProviderOrderId = (
  historyRecord: TradingOrderHistoryRecord
): string | null =>
  firstDefinedString(
    historyRecord?.response?.orderId,
    historyRecord?.normalizedOrder?.id,
    historyRecord?.normalizedOrder?.raw?.id,
    historyRecord?.response?.raw?.id,
    historyRecord?.response?.raw?.order_id,
    historyRecord?.response?.raw?.order?.id,
    historyRecord?.response?.raw?.order?.order_id
  )

export const buildAlpacaOrderDetailRequest = (
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): TradingRequestConfig => {
  const environment =
    params.environment ||
    firstDefinedString(
      historyRecord.environment,
      historyRecord.request?.providerParams?.environment,
      historyRecord.request?.environment
    ) ||
    undefined

  const authHeaders = buildAlpacaAuthHeaders({
    accessToken: params.accessToken,
    apiKey: params.apiKey,
    apiSecret: params.apiSecret,
  } as TradingHoldingsInput)

  const baseUrl =
    environment === 'paper' ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets'

  return {
    url: `${baseUrl}/v2/orders/${encodeURIComponent(providerOrderId)}`,
    method: 'GET',
    headers: {
      ...authHeaders,
      Accept: 'application/json',
    },
  }
}

export const normalizeAlpacaOrderDetail = (
  appOrderId: string,
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  rawOrder: Record<string, any>
): TradingOrderDetailOutput => ({
  appOrderId,
  provider: 'alpaca',
  providerOrderId,
  environment: historyRecord.environment ?? null,
  clientOrderId: firstDefinedString(rawOrder.client_order_id, rawOrder.clientOrderId),
  createdAt: firstDefinedString(rawOrder.created_at, rawOrder.createdAt),
  updatedAt: firstDefinedString(rawOrder.updated_at, rawOrder.updatedAt),
  submittedAt: firstDefinedString(rawOrder.submitted_at, rawOrder.submittedAt),
  filledAt: firstDefinedString(rawOrder.filled_at, rawOrder.filledAt),
  canceledAt: firstDefinedString(rawOrder.canceled_at, rawOrder.canceledAt),
  expiredAt: firstDefinedString(rawOrder.expired_at, rawOrder.expiredAt),
  symbol: firstDefinedString(rawOrder.symbol),
  side: firstDefinedString(rawOrder.side),
  status: firstDefinedString(rawOrder.status),
  orderType: firstDefinedString(rawOrder.type, rawOrder.order_type),
  timeInForce: firstDefinedString(rawOrder.time_in_force, rawOrder.timeInForce),
  quantity: rawOrder.qty ?? rawOrder.quantity ?? null,
  filledQuantity: rawOrder.filled_qty ?? rawOrder.filledQuantity ?? null,
  remainingQuantity: rawOrder.remaining_qty ?? rawOrder.remainingQuantity ?? null,
  notional: rawOrder.notional ?? null,
  limitPrice: rawOrder.limit_price ?? rawOrder.limitPrice ?? null,
  stopPrice: rawOrder.stop_price ?? rawOrder.stopPrice ?? null,
  averageFillPrice: rawOrder.filled_avg_price ?? rawOrder.averageFillPrice ?? null,
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

export const alpacaOrderDetailRequest = async (
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> => {
  const providerOrderId = resolveAlpacaOrderDetailProviderOrderId(historyRecord)
  if (!providerOrderId) {
    throw new Error('Unable to resolve Alpaca provider order ID from order history record.')
  }

  const request = buildAlpacaOrderDetailRequest(providerOrderId, historyRecord, params)
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
  })

  if (!response.ok) {
    const details = await parseErrorPayload(response)
    throw Object.assign(new Error('Failed to fetch Alpaca order detail.'), {
      status: response.status,
      details,
      providerOrderId,
    })
  }

  const rawOrder = toRecord(await response.json().catch(() => ({})))

  return {
    providerOrderId,
    orderDetail: normalizeAlpacaOrderDetail(historyRecord.id, providerOrderId, historyRecord, rawOrder),
  }
}
