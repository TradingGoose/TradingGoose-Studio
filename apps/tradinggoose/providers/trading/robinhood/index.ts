import type { TradingProvider } from '@/providers/trading/providers'
import { robinhoodTradingProviderConfig } from '@/providers/trading/robinhood/config'
import {
  buildRobinhoodOrderRequest,
  normalizeRobinhoodOrder,
} from '@/providers/trading/robinhood/orders'
import { robinhoodOrderDetailRequest } from '@/providers/trading/robinhood/orderDetail'
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
  orderDetailRequest: robinhoodOrderDetailRequest,
  normalizeOrder: normalizeRobinhoodOrder,
  normalizeHoldings: normalizeRobinhoodHoldings,
}
