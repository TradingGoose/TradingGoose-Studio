import { alpacaOrderDetailRequest } from '@/providers/trading/alpaca/orderDetail'
import { buildAlpacaOrderRequest, normalizeAlpacaOrder } from '@/providers/trading/alpaca/orders'
import type { TradingProviderAdapter } from '@/providers/trading/providers'

export const alpacaProvider: TradingProviderAdapter = {
  buildOrderRequest: buildAlpacaOrderRequest,
  orderDetailRequest: alpacaOrderDetailRequest,
  normalizeOrder: normalizeAlpacaOrder,
}
