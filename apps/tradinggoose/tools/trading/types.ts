import type { TradingOrderSubmitRequest } from '@/lib/trading/order-types'
import type { TradingProviderId } from '@/providers/trading/types'

export interface TradingActionParams
  extends Omit<
    TradingOrderSubmitRequest,
    'workspaceId' | 'workflowId' | 'submissionSource' | 'logId' | 'idempotencyKey'
  > {
  _context?: {
    workspaceId?: string
    workflowId?: string
    userId?: string
    executionId?: string
    workflowLogId?: string
    toolExecutionId?: string
    submissionSource?: 'manual' | 'copilot' | 'workflow'
  }
}

export interface TradingOrderDetailParams {
  orderId: string
}

export interface TradingOrderDetailOutput {
  appOrderId: string
  provider: TradingProviderId
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
    provider: TradingProviderId
    appOrderId: string
    providerOrderId: string
    workspaceId: string | null
    logId: string | null
    orderDetail: TradingOrderDetailOutput
  }
  error?: string
}
