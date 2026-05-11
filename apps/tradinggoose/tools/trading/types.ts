import type { ListingInputValue } from '@/lib/listing/identity'
import type { PortfolioIdentity } from '@/providers/trading/portfolio-identity'
import type {
  TradingActionResponse,
  TradingHoldingsResponse,
  TradingOrderType,
  TradingProviderId,
} from '@/providers/trading/types'

export interface TradingActionParams {
  provider: TradingProviderId
  portfolioIdentity: PortfolioIdentity
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
  credential?: string
  accessToken?: string
  orderSizingMode?: string
  orderClass?: string
  _context?: {
    workspaceId?: string
    userId?: string
    executionId?: string
    workflowLogId?: string
    submissionSource?: 'manual' | 'copilot' | 'workflow'
  }
}

export interface TradingHoldingsParams {
  provider: TradingProviderId
  portfolioIdentity?: PortfolioIdentity | null
  credential?: string
  accessToken?: string
}

export interface TradingOrderDetailParams {
  orderId: string
  provider?: TradingProviderId
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
    workspaceId: string | null
    logId: string | null
    orderDetail: TradingOrderDetailOutput
  }
  error?: string
}

export type { TradingActionResponse, TradingHoldingsResponse }
