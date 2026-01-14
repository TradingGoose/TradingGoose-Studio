import type { TradingProvider } from '@/providers/trading/providers'
import { robinhoodTradingProviderConfig } from '@/providers/trading/robinhood/config'
import {
  buildRobinhoodOrderRequest,
  normalizeRobinhoodOrder,
} from '@/providers/trading/robinhood/orders'
import {
  buildRobinhoodHoldingsRequest,
  normalizeRobinhoodHoldings,
} from '@/providers/trading/robinhood/positions'

export const robinhoodProvider: TradingProvider = {
  id: 'robinhood',
  name: 'Robinhood',
  config: robinhoodTradingProviderConfig,
  defaults: {
    orderType: 'market',
    timeInForce: 'gfd',
  },
  buildOrderRequest: buildRobinhoodOrderRequest,
  buildHoldingsRequest: buildRobinhoodHoldingsRequest,
  normalizeOrder: normalizeRobinhoodOrder,
  normalizeHoldings: normalizeRobinhoodHoldings,
}
