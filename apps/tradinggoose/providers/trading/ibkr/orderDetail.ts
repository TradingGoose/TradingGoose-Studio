import { buildIbkrAuthHeaders } from '@/providers/trading/ibkr/auth'
import { buildIbkrAccountUrl } from '@/providers/trading/ibkr/client'
import { fetchBrokerJson } from '@/providers/trading/portfolio-utils'
import type {
  TradingOrderDetailInput,
  TradingOrderDetailOutput,
  TradingOrderDetailResult,
  TradingOrderHistoryRecord,
} from '@/providers/trading/types'

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

export const resolveIbkrOrderDetailProviderOrderId = (
  historyRecord: TradingOrderHistoryRecord
): string | null =>
  firstDefinedString(
    historyRecord?.response?.orderId,
    historyRecord?.normalizedOrder?.id,
    historyRecord?.normalizedOrder?.raw?.order?.order_id,
    historyRecord?.response?.raw?.order?.order_id,
    historyRecord?.response?.raw?.order_id
  )

const normalizeIbkrOrderTimestamp = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) {
    return new Date(numeric * 1000).toISOString()
  }
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null
}

export const normalizeIbkrOrderDetail = (
  appOrderId: string,
  providerOrderId: string,
  historyRecord: TradingOrderHistoryRecord,
  rawOrder: Record<string, any>
): TradingOrderDetailOutput => ({
  appOrderId,
  provider: 'ibkr',
  providerOrderId,
  environment: historyRecord.environment ?? null,
  clientOrderId: firstDefinedString(rawOrder.order_ref, rawOrder.orderRef),
  createdAt: normalizeIbkrOrderTimestamp(rawOrder.submit_time) ?? undefined,
  updatedAt: normalizeIbkrOrderTimestamp(rawOrder.last_update_time) ?? undefined,
  submittedAt: normalizeIbkrOrderTimestamp(rawOrder.submit_time) ?? undefined,
  filledAt: undefined,
  canceledAt: undefined,
  expiredAt: undefined,
  symbol: firstDefinedString(rawOrder.ticker, rawOrder.symbol),
  side: firstDefinedString(rawOrder.side),
  status: firstDefinedString(rawOrder.status),
  orderType: firstDefinedString(rawOrder.order_type, rawOrder.orderType),
  timeInForce: firstDefinedString(rawOrder.tif, rawOrder.timeInForce),
  quantity: rawOrder.quantity ?? rawOrder.totalQuantity ?? null,
  filledQuantity: rawOrder.filled ?? rawOrder.filledQuantity ?? null,
  remainingQuantity:
    rawOrder.remainingQuantity ??
    (typeof rawOrder.quantity === 'number' && typeof rawOrder.filled === 'number'
      ? rawOrder.quantity - rawOrder.filled
      : null),
  notional: null,
  limitPrice: rawOrder.lmt_price ?? rawOrder.limitPrice ?? null,
  stopPrice: rawOrder.aux_price ?? rawOrder.auxPrice ?? rawOrder.stopPrice ?? null,
  averageFillPrice: rawOrder.avg_price ?? rawOrder.averageFillPrice ?? null,
  raw: rawOrder,
})

const toRecord = (value: unknown): Record<string, any> => {
  if (value && typeof value === 'object') {
    return value as Record<string, any>
  }
  return { value }
}

const flattenOrders = (value: unknown): any[] => {
  if (Array.isArray(value)) {
    return value.flatMap(flattenOrders)
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, any>
    const orders = record.orders
    if (Array.isArray(orders)) {
      return orders.flatMap(flattenOrders)
    }
    const recordOrders = record.order
    if (Array.isArray(recordOrders)) {
      return recordOrders.flatMap(flattenOrders)
    }
  }
  return value && typeof value === 'object' && 'order_id' in (value as object) ? [value] : []
}

export const findIbkrOrderById = (
  rawOrders: unknown,
  providerOrderId: string,
  clientOrderId?: string | null
): Record<string, any> | null => {
  const normalizedProviderOrderId = providerOrderId.trim()
  const normalizedClientOrderId = clientOrderId?.trim()

  const candidates = flattenOrders(rawOrders)
  for (const candidate of candidates) {
    const record = toRecord(candidate)
    const candidateOrderId = firstDefinedString(record.order_id, record.orderId, record.ibkrOrderId)
    const candidateOrderRef = firstDefinedString(record.order_ref, record.orderRef)

    if (candidateOrderId === normalizedProviderOrderId) {
      return record
    }
    if (normalizedClientOrderId && candidateOrderRef === normalizedClientOrderId) {
      return record
    }
  }

  return null
}

export const ibkrOrderDetailRequest = async (
  historyRecord: TradingOrderHistoryRecord,
  params: TradingOrderDetailInput
): Promise<TradingOrderDetailResult> => {
  const providerOrderId = resolveIbkrOrderDetailProviderOrderId(historyRecord)
  if (!providerOrderId) {
    throw new Error('Unable to resolve IBKR provider order ID from order history record.')
  }

  const accountId = params.accountId ?? historyRecord?.response?.accountId
  if (!accountId) {
    throw new Error('IBKR order detail requires accountId.')
  }

  const headers = buildIbkrAuthHeaders({ accessToken: params.accessToken })
  const rawOrders = await fetchBrokerJson<unknown>({
    providerId: 'ibkr',
    url: buildIbkrAccountUrl(String(accountId), '/orders'),
    init: {
      method: 'GET',
      headers,
    },
  })

  const rawOrder = findIbkrOrderById(
    rawOrders,
    providerOrderId,
    historyRecord?.response?.clientOrderId
  )
  if (!rawOrder) {
    throw new Error('IBKR order not found in account orders.')
  }

  return {
    providerOrderId,
    orderDetail: normalizeIbkrOrderDetail(
      historyRecord.id,
      providerOrderId,
      historyRecord,
      rawOrder
    ),
  }
}
