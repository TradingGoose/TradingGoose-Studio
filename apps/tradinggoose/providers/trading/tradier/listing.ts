import type { TradingSymbolInput } from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { tradierTradingProviderConfig } from '@/providers/trading/tradier/config'

export const normalizeTradierListingSymbol = (input: TradingSymbolInput): string =>
  resolveTradingSymbol(tradierTradingProviderConfig, input)
