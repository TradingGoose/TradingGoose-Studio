import type { MarketSymbolRule } from '@/providers/market/providers'

export const yfinanceSymbolRules: MarketSymbolRule[] = [
  {
    city: 'SHANGHAI',
    template: '{base}.ss',
    active: true,
  }, {
    city: 'SHENZHEN',
    template: '{base}.sz', // AAPL/USD => AAPL.SZ 
    active: true,
  },
  {
    assetClass: 'stock',
    market: 'HKEX',
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
    assetClass: 'stock',
    market: 'TO',
    template: '{base}.TO',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]
