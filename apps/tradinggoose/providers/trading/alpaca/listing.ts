import type { TradingSymbolInput } from '@/providers/trading/types'
import { resolveTradingSymbol } from '@/providers/trading/utils'
import { alpacaTradingProviderConfig } from '@/providers/trading/alpaca/config'

export const normalizeAlpacaListingSymbol = (input: TradingSymbolInput): string =>
  resolveTradingSymbol(alpacaTradingProviderConfig, input)
