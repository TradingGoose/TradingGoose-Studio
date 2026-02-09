import type { MarketSymbolRule } from '@/providers/market/providers'

export const alphaVantageSymbolRules: MarketSymbolRule[] = [
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
    template: '{base}{exchangeSuffix}',
    active: true,
  },
]
