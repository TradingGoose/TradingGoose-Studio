import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import type { TradingOrder } from '@/providers/trading/types'

export type QuickOrderResolvedListing =
  | ListingResolved
  | (ListingIdentity & Record<string, unknown>)

export interface QuickOrderSubmitRequest {
  provider: string
  credentialServiceId?: string
  accountId: string
  listing: QuickOrderResolvedListing
  side: 'buy' | 'sell'
  quantity?: number
  notional?: number
  orderSizingMode?: 'quantity' | 'notional'
  orderType?: string
  timeInForce?: string
  limitPrice?: number
  stopPrice?: number
  trailPrice?: number
  trailPercent?: number
}

export interface QuickOrderSubmitResponse {
  order: TradingOrder | null
  provider: string
  accountId: string
  message?: string | null
}
