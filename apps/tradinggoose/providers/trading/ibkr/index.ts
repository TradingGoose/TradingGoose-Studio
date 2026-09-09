import { ibkrOrderDetailRequest } from '@/providers/trading/ibkr/orderDetail'
import { buildIbkrOrderRequest, normalizeIbkrOrder } from '@/providers/trading/ibkr/orders'
import type { TradingProviderAdapter } from '@/providers/trading/providers'

export const ibkrProvider: TradingProviderAdapter = {
  buildOrderRequest: buildIbkrOrderRequest,
  orderDetailRequest: ibkrOrderDetailRequest,
  normalizeOrder: normalizeIbkrOrder,
}
