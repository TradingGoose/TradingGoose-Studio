import type { TradingProvider } from '@/providers/trading/providers'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'
import {
  buildAlpacaOrderRequest,
  normalizeAlpacaOrder,
} from '@/providers/trading/alpaca/orders'
import {
  buildAlpacaHoldingsRequest,
  normalizeAlpacaHoldings,
} from '@/providers/trading/alpaca/positions'

export const alpacaProvider: TradingProvider = {
  id: 'alpaca',
  name: 'Alpaca',
  config: alpacaTradingProviderConfig,
  defaults: {
    orderType: 'market',
    timeInForce: 'day',
  },
  buildOrderRequest: buildAlpacaOrderRequest,
  buildHoldingsRequest: buildAlpacaHoldingsRequest,
  normalizeOrder: normalizeAlpacaOrder,
  normalizeHoldings: normalizeAlpacaHoldings,
}
