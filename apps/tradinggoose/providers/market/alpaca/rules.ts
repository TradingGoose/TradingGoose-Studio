import type { MarketSymbolRule } from '@/providers/market/providers'

export const alpacaSymbolRules: MarketSymbolRule[] = [
  {
    assetClass: 'crypto',
    template: '{base}/{quote}',
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
    mic: 'IEXG',
    template: '{base}',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]
