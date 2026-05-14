import type { TradingProviderAdapter } from '@/providers/trading/providers'
import { tradierOrderDetailRequest } from '@/providers/trading/tradier/orderDetail'
import { buildTradierOrderRequest, normalizeTradierOrder } from '@/providers/trading/tradier/orders'

export const tradierProvider: TradingProviderAdapter = {
  buildOrderRequest: buildTradierOrderRequest,
  orderDetailRequest: tradierOrderDetailRequest,
  normalizeOrder: normalizeTradierOrder,
}
