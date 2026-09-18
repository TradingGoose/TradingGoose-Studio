import type { TradingProviderAdapter } from '@/providers/trading/providers'
import {
  normalizeRobinhoodOrder,
  robinhoodOrderDetailRequest,
  submitRobinhoodOrder,
} from '@/providers/trading/robinhood/orders'

export const robinhoodProvider: TradingProviderAdapter = {
  submitOrder: submitRobinhoodOrder,
  normalizeOrder: normalizeRobinhoodOrder,
  orderDetailRequest: robinhoodOrderDetailRequest,
}
