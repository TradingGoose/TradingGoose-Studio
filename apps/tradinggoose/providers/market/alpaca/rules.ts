import type { MarketSymbolRule } from '@/providers/market/providers'

export const alpacaSymbolRules: MarketSymbolRule[] = [
  {
    assetClass: 'crypto',
    template: '{base}/{quote}',
    active: true,
  },
  {
    market: 'NYSE',
    template: '{base}',
    active: true,
  },
  {
    market: 'NASDAQ',
    template: '{base}',
    active: true,
  },
  {
    market: 'CBOE',
    template: '{base}',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]
