import type { MarketSymbolRule } from '@/providers/market/providers'

export const finnhubSymbolRules: MarketSymbolRule[] = [
  {
    assetClass: 'currency',
    template: 'OANDA:{base}_{quote}',
    active: true,
  },
  {
    assetClass: 'crypto',
    template: 'BINANCE:{base}{quote}',
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
    template: '{base}{exchangeSuffix}',
    active: true,
  },
]
