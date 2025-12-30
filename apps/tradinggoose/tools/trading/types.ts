import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingProviderId,
} from '@/trading_providers/types'

export interface TradingActionParams {
  provider: TradingProviderId
  symbol: string
  side: 'buy' | 'sell'
  quantity: number
  orderType?: string
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  environment?: 'paper' | 'live'
  // Auth
  credential?: string
  accessToken?: string
  tradierCredential?: string
  robinhoodCredential?: string
  alpacaCredential?: string
  // Provider-specific extras
  accountId?: string
  accountUrl?: string
  instrumentUrl?: string
}

export interface TradingHoldingsParams {
  provider: TradingProviderId
  environment?: 'paper' | 'live'
  credential?: string
  accessToken?: string
  tradierCredential?: string
  robinhoodCredential?: string
  alpacaCredential?: string
  accountId?: string
  accountUrl?: string
}

export type { TradingActionResponse, TradingHoldingsResponse }
