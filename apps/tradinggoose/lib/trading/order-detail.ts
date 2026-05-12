import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  logTradingBrokerRequestFailure,
  resolveTradingProviderContext,
} from '@/lib/trading/context'
import { TradingServiceError } from '@/lib/trading/errors'
import {
  readOrderAccountId,
  readOrderCredentialId,
  readOrderServiceId,
} from '@/lib/trading/order-records'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'
import { TradingBrokerRequestError } from '@/providers/trading/portfolio-utils'
import type { TradingOrderDetailInput, TradingOrderHistoryRecord } from '@/providers/trading/types'

export type TradingProviderOrderDetailResult = {
  appOrderId: string
  logId: string | null
  orderId: string
  orderDetail: Record<string, any>
  provider: string
  providerOrderId: string
  providerDetail: {
    providerOrderId: string
    orderDetail: Record<string, any>
  }
  workspaceId: string
}

export async function getRecordedTradingOrderProviderDetail({
  orderId,
  requestId,
  userId,
  workspaceId,
}: {
  orderId: string
  requestId: string
  userId: string
  workspaceId: string
}): Promise<TradingProviderOrderDetailResult> {
  const access = await checkWorkspaceAccess(workspaceId, userId)
  if (!access.exists || !access.hasAccess) {
    throw new TradingServiceError('Not found', 404)
  }

  const [order] = await db
    .select()
    .from(orderHistoryTable)
    .where(and(eq(orderHistoryTable.id, orderId), eq(orderHistoryTable.workspaceId, workspaceId)))
    .limit(1)

  if (!order) {
    throw new TradingServiceError('Not found', 404)
  }

  if (order.provider === 'tradier' && !readOrderAccountId(order)) {
    throw new TradingServiceError('Tradier order history record is missing accountId')
  }

  const credentialId = readOrderCredentialId(order)
  const serviceId = readOrderServiceId(order)
  if (!credentialId || !serviceId) {
    throw new TradingServiceError('Order history record is missing trading credential context')
  }

  const baseContext = await resolveTradingProviderContext({
    requestData: {
      provider: order.provider,
      credentialId,
      serviceId,
    },
    requestId,
    userId,
  })

  const detailInput: TradingOrderDetailInput = {
    orderId,
    provider: order.provider,
    environment: baseContext.environment,
    accessToken: baseContext.accessToken,
  }
  let providerDetail: Awaited<ReturnType<typeof executeTradingProviderOrderDetailRequest>>
  try {
    providerDetail = await executeTradingProviderOrderDetailRequest(
      order.provider,
      order as TradingOrderHistoryRecord,
      detailInput
    )
  } catch (error) {
    logTradingBrokerRequestFailure('order-detail', error)
    throw new TradingServiceError(
      error instanceof TradingBrokerRequestError ? 'Broker request failed' : 'Order detail failed',
      error instanceof TradingBrokerRequestError ? error.status : 502
    )
  }

  return {
    appOrderId: order.id,
    logId: order.logId,
    orderId,
    orderDetail: providerDetail.orderDetail,
    provider: order.provider,
    providerOrderId: providerDetail.providerOrderId,
    providerDetail,
    workspaceId: order.workspaceId,
  }
}
