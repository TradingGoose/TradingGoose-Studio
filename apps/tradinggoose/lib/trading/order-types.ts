import type { ListingIdentity, ListingResolved } from '@/lib/listing/identity'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import type { TradingOrder } from '@/providers/trading/types'

export type TradingOrderSubmitListing =
  | ListingResolved
  | (ListingIdentity & Record<string, unknown>)

export type TradingOrderSubmissionSource = 'manual' | 'copilot' | 'workflow'

export interface TradingOrderSubmitRequest {
  workspaceId: string
  workflowId?: string
  portfolioIdentity: PortfolioIdentity
  listing: TradingOrderSubmitListing
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
  orderClass?: string
  providerParams?: Record<string, unknown>
  idempotencyKey: string
  submissionSource?: TradingOrderSubmissionSource
  logId?: string
}

export interface TradingOrderSubmitResponse {
  appOrderId: string
  clientOrderId: string
  order: TradingOrder | null
  provider: string
  accountId: string
  message?: string | null
  historyWarning?: string | null
}
