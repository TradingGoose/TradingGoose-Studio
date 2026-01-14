import type { TradingSymbolRule } from '@/providers/trading/providers'

export const alpacaTradingSymbolRules: TradingSymbolRule[] = [
  {
    assetClass: 'crypto',
    template: '{base}/{quote}',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]
