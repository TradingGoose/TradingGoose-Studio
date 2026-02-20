import { buildTradierAuthHeaders, resolveTradierBaseUrl } from '@/providers/trading/tradier/client'
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

const resolveTradierAccountId = (
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): string | null =>
  firstDefinedString(
    params.accountId,
    historyRecord.request?.providerParams?.accountId,
    historyRecord.request?.providerParams?.account_id,
    historyRecord.request?.providerParams?.account,
    historyRecord.response?.raw?.account_id,
    historyRecord.response?.raw?.order?.account_id
  )

export const resolveTradierOrderDetailProviderOrderId = (
  historyRecord: TradingOrderHistoryRecord
): string | null =>
  firstDefinedString(
    historyRecord.response?.orderId,
    historyRecord.normalizedOrder?.id,
    historyRecord.response?.raw?.id,
    historyRecord.response?.raw?.order?.id
  )

export const buildTradierOrderDetailRequest = (
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): TradingRequestConfig => {
  const accountId = resolveTradierAccountId(historyRecord, params)
  if (!accountId) {
    throw new Error(
      'Tradier accountId is required to fetch order details. Provide accountId or use an order recorded with account metadata.'
    )
  }

  const environment =
    params.environment ||
    firstDefinedString(
      historyRecord.environment,
      historyRecord.request?.providerParams?.environment,
      historyRecord.request?.environment
    ) ||
    undefined
  const baseUrl = resolveTradierBaseUrl(environment ?? undefined)
  const authHeaders = buildTradierAuthHeaders({
    accessToken: params.accessToken,
  } as TradingHoldingsInput)

  return {
    url: `${baseUrl}/accounts/${encodeURIComponent(accountId)}/orders/${encodeURIComponent(providerOrderId)}`,
    method: 'GET',
    headers: {
      ...authHeaders,
      Accept: 'application/json',
    },
  }
}

export const normalizeTradierOrderDetail = (
  appOrderId: string,
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  rawOrderResponse: Record<string, any>
): TradingOrderDetailOutput => {
  const rawOrder = rawOrderResponse.order || rawOrderResponse
  return {
    appOrderId,
    provider: 'tradier',
    providerOrderId,
    environment: historyRecord.environment ?? null,
    clientOrderId: firstDefinedString(rawOrder.client_order_id, rawOrder.clientOrderId),
    createdAt: firstDefinedString(rawOrder.create_date, rawOrder.created_at, rawOrder.createdAt),
    updatedAt: firstDefinedString(rawOrder.updated_at, rawOrder.updatedAt, rawOrder.last_fill_date),
    submittedAt: firstDefinedString(
      rawOrder.transaction_date,
      rawOrder.create_date,
      rawOrder.submitted_at
    ),
    filledAt: firstDefinedString(rawOrder.last_fill_date, rawOrder.filled_at),
    canceledAt: firstDefinedString(rawOrder.cancel_date, rawOrder.canceled_at),
    expiredAt: firstDefinedString(rawOrder.expiration_date, rawOrder.expired_at),
    symbol: firstDefinedString(rawOrder.symbol),
    side: firstDefinedString(rawOrder.side),
    status: firstDefinedString(rawOrder.status),
    orderType: firstDefinedString(rawOrder.type, rawOrder.order_type),
    timeInForce: firstDefinedString(rawOrder.duration, rawOrder.time_in_force),
    quantity: rawOrder.quantity ?? null,
    filledQuantity: rawOrder.exec_quantity ?? rawOrder.filled_quantity ?? null,
    remainingQuantity: rawOrder.remaining_quantity ?? null,
    notional: rawOrder.notional ?? rawOrder.amount ?? null,
    limitPrice: rawOrder.price ?? rawOrder.limit_price ?? null,
    stopPrice: rawOrder.stop ?? rawOrder.stop_price ?? null,
    averageFillPrice: rawOrder.avg_fill_price ?? rawOrder.average_fill_price ?? null,
    raw: rawOrderResponse,
  }
}

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

export const tradierOrderDetailRequest = async (
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> => {
  const providerOrderId = resolveTradierOrderDetailProviderOrderId(historyRecord)
  if (!providerOrderId) {
    throw new Error('Unable to resolve Tradier provider order ID from order history record.')
  }

  const request = buildTradierOrderDetailRequest(providerOrderId, historyRecord, params)
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
  })

  if (!response.ok) {
    const details = await parseErrorPayload(response)
    throw Object.assign(new Error('Failed to fetch Tradier order detail.'), {
      status: response.status,
      details,
      providerOrderId,
    })
  }

  const rawOrder = toRecord(await response.json().catch(() => ({})))

  return {
    providerOrderId,
    orderDetail: normalizeTradierOrderDetail(
      historyRecord.id,
      providerOrderId,
      historyRecord,
      rawOrder
    ),
  }
}
