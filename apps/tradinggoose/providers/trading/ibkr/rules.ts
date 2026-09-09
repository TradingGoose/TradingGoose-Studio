import { IBKR_DEFAULT_API_IP } from '@/providers/trading/ibkr/config'
import type { TradingSymbolRule } from '@/providers/trading/providers'

export const ibkrTradingSymbolRules: TradingSymbolRule[] = [
  {
    currency: 'USD',
    template: '{base}',
    active: true,
  },
  {
    currency: 'EUR',
    template: '{base}',
    active: true,
  },
  {
    currency: 'GBP',
    template: '{base}',
    active: true,
  },
  {
    currency: 'JPY',
    template: '{base}',
    active: true,
  },
  {
    assetClass: 'currency',
    template: '{base}{quote}',
    active: true,
  },
  {
    template: '{base}',
    active: true,
  },
]

export const IBKR_API_IP = IBKR_DEFAULT_API_IP
