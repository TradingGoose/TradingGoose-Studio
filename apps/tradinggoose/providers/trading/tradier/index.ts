import type { TradingProvider } from '@/providers/trading/providers'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'
import {
  buildTradierOrderRequest,
  normalizeTradierOrder,
} from '@/providers/trading/tradier/orders'
import {
  buildTradierHoldingsRequest,
  normalizeTradierHoldings,
} from '@/providers/trading/tradier/positions'

export const tradierProvider: TradingProvider = {
  id: 'tradier',
  name: 'Tradier',
  config: tradierTradingProviderConfig,
  defaults: {
    orderType: 'market',
    timeInForce: 'day',
  },
  buildOrderRequest: buildTradierOrderRequest,
  buildHoldingsRequest: buildTradierHoldingsRequest,
  normalizeOrder: normalizeTradierOrder,
  normalizeHoldings: normalizeTradierHoldings,
}
