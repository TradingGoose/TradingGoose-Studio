import type { TradingSymbolInput } from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { robinhoodTradingProviderConfig } from '@/providers/trading/robinhood/config'

export const normalizeRobinhoodListingSymbol = (input: TradingSymbolInput): string =>
  resolveTradingSymbol(robinhoodTradingProviderConfig, input)
