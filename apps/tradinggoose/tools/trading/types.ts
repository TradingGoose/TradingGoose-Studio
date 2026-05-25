import type { TradingOrderSubmitRequest } from '@/lib/trading/order-types'
import type { TradingOrderDetailOutput, TradingProviderId } from '@/providers/trading/types'

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
