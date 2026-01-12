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
    mic: 'XNYS',
    template: '{base}',
    active: true,
  },
  {
    mic: 'XNAS',
    template: '{base}',
    active: true,
  },
  {
    mic: 'XASE',
    template: '{base}',
    active: true,
  },
  {
    mic: 'ARCX',
    template: '{base}',
    active: true,
  },
  {
    mic: 'BATS',
    template: '{base}',
    active: true,
  },
  {
    template: '{base}{exchangeSuffix}',
    active: true,
  },
]
