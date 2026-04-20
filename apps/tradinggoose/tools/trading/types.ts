import type { ListingIdentity, ListingInputValue } from '@/lib/listing/identity'
import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingOrderType,
  TradingProviderId,
} from '@/providers/trading/types'

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
  alpacaCredential?: string
  // Provider-specific extras
  accountId?: string
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
}

export interface TradingOrderDetailParams {
  orderId: string
  provider?: TradingProviderId
  environment?: 'paper' | 'live'
  credential?: string
  accessToken?: string
  apiKey?: string
  apiSecret?: string
  tradierCredential?: string
  alpacaCredential?: string
  accountId?: string
}

export interface TradingOrderDetailOutput {
  appOrderId: string
  provider: TradingProviderId | string
  providerOrderId: string
  environment?: string | null
  clientOrderId?: string | null
  createdAt?: string | null
  updatedAt?: string | null
  submittedAt?: string | null
  filledAt?: string | null
  canceledAt?: string | null
  expiredAt?: string | null
  symbol?: string | null
  side?: string | null
  status?: string | null
  orderType?: string | null
  timeInForce?: string | null
  quantity?: string | number | null
  filledQuantity?: string | number | null
  remainingQuantity?: string | number | null
  notional?: string | number | null
  limitPrice?: string | number | null
  stopPrice?: string | number | null
  averageFillPrice?: string | number | null
  raw?: unknown
}

export interface TradingOrderDetailResponse {
  success: boolean
  output: {
    summary: string
    provider: TradingProviderId | string
    appOrderId: string
    providerOrderId: string
    orderDetail: TradingOrderDetailOutput
  }
  error?: string
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
