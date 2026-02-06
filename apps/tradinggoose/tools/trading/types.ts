import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingProviderId,
  TradingOrderType,
} from '@/providers/trading/types'
import type { ListingIdentity, ListingInputValue, ListingType } from '@/lib/listing/identity'

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
  orderSizingMode?: string
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

export interface OrderSubmitRequest {
  side: 'buy' | 'sell'
  orderType?: TradingOrderType
  timeInForce?: string
  quantity?: number
  notional?: number
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
  trailPercent?: number
  orderSizingMode?: string
  orderClass?: string
  providerParams?: Record<string, unknown>
}

export interface OrderSubmitResponse {
  success: boolean
  orderId?: string | null
  clientOrderId?: string | null
  createdAt?: string | null
  submittedAt?: string | null
  symbol?: string | null
  status?: string | null
  errorMessage?: string | null
  raw?: unknown
}

export interface OrderSubmit {
  id?: string
  provider: TradingProviderId
  environment?: 'paper' | 'live' | string
  recordedAt: string
  workflowId?: string
  workflowExecutionId?: string
  listingId?: string | null
  listingKey?: string | null
  listingType?: ListingType
  listingIdentity?: ListingIdentity | null
  request: OrderSubmitRequest
  response: OrderSubmitResponse
  normalizedOrder?: Record<string, any>
}

export type OrderHistory = OrderSubmit[]

export interface OrderStatus {
  id?: string | null
  clientOrderId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  submittedAt?: string | null
  filledAt?: string | null
  expiredAt?: string | null
  canceledAt?: string | null
  failedAt?: string | null
  replacedAt?: string | null
  replacedBy?: string | null
  replaces?: string | null
  assetId?: string | null
  symbol?: string | null
  assetClass?: string | null
  notional?: string | number | null
  qty?: string | number | null
  filledQty?: string | number | null
  filledAvgPrice?: string | number | null
  orderClass?: string | null
  orderType?: string | null
  side?: string | null
  timeInForce?: string | null
  limitPrice?: string | number | null
  stopPrice?: string | number | null
  status?: string | null
  extendedHours?: boolean | null
  legs?: OrderStatus[] | null
  raw?: unknown
}

export type { TradingActionResponse, TradingHoldingsResponse }
