import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingProviderId,
} from '@/providers/trading/types'
import type { ListingInputValue } from '@/lib/listing/identity'

export interface TradingActionParams {
  provider: TradingProviderId
  listing: ListingInputValue
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
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  accountId?: string
  accountUrl?: string
}

export type { TradingActionResponse, TradingHoldingsResponse }
