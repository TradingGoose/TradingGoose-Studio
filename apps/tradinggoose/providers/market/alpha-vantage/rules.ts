import type { MarketSymbolRule } from '@/providers/market/providers'

export const alphaVantageSymbolRules: MarketSymbolRule[] = [
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
