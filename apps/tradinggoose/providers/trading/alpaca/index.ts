import type { TradingProvider } from '@/providers/trading/providers'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import {
  buildAlpacaOrderRequest,
  normalizeAlpacaOrder,
} from '@/providers/trading/alpaca/orders'
import { alpacaOrderDetailRequest } from '@/providers/trading/alpaca/orderDetail'

export const alpacaProvider: TradingProvider = {
  id: 'alpaca',
  name: 'Alpaca',
  config: alpacaTradingProviderConfig,
  defaults: {
    orderType: 'market',
    timeInForce: 'day',
  },
  buildOrderRequest: buildAlpacaOrderRequest,
  orderDetailRequest: alpacaOrderDetailRequest,
  normalizeOrder: normalizeAlpacaOrder,
}
