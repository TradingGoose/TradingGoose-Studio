import type { MarketSymbolRule } from '@/providers/market/providers'

export const yfinanceSymbolRules: MarketSymbolRule[] = [
  {
    city: 'SHANGHAI',
    template: '{base}.ss',
    active: true,
  }, {
    city: 'SHENZHEN',
    template: '{base}.sz',
    active: true,
  },
  {
    assetClass: 'stock',
    mic: 'XHKG',
    template: '{base}.HK',
    active: true,
  },
  {
    assetClass: 'stock',
    country: 'HK',
    template: '{base}.HK',
    regex: '^{base}/{quote}$',
    active: true,
  },
  {
    assetClass: 'crypto',
    template: '{base}-{quote}',
    active: true,
  },
  {
    assetClass: 'currency',
    template: '{base}{quote}=X',
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
    template: '{base}',
    active: true,
  },
]
