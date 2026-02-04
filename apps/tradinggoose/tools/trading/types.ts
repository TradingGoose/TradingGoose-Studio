import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingProviderId,
  TradingOrderType,
} from '@/providers/trading/types'
import type { ListingInputValue } from '@/lib/listing/identity'

export interface TradingActionParams {
  provider: TradingProviderId
  listing: ListingInputValue
  side: 'buy' | 'sell'
  quantity?: number
  notional?: number
  orderType?: TradingOrderType
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
  trailPercent?: number
  environment?: 'paper' | 'live'
  // Auth
  credential?: string
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  tradierCredential?: string
  robinhoodCredential?: string
  alpacaCredential?: string
  // Provider-specific extras
  accountId?: string
  accountUrl?: string
  instrumentUrl?: string
  orderSizingMode?:string
  orderClass?: string
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
