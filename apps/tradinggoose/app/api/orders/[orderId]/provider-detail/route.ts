import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { resolveTradingProviderContext } from '@/app/api/providers/trading/shared'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'
import type { TradingOrderDetailInput, TradingOrderHistoryRecord } from '@/providers/trading/types'
import {
  readOrderAccountId,
  readOrderCredentialId,
  readOrderCredentialServiceId,
} from '../../order-record-utils'

const logger = createLogger('OrderProviderDetailAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = new URL(request.url).searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const access = await checkWorkspaceAccess(workspaceId, auth.userId)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { orderId } = await params
    const [order] = await db
      .select()
      .from(orderHistoryTable)
      .where(and(eq(orderHistoryTable.id, orderId), eq(orderHistoryTable.workspaceId, workspaceId)))
      .limit(1)

    if (!order) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (order.provider === 'tradier' && !readOrderAccountId(order)) {
      return NextResponse.json(
        { error: 'Tradier order history record is missing accountId' },
        { status: 400 }
      )
    }

    const credentialId = readOrderCredentialId(order)
    const credentialServiceId = readOrderCredentialServiceId(order)
    if (!credentialId || !credentialServiceId) {
      return NextResponse.json(
        { error: 'Order history record is missing trading credential context' },
        { status: 400 }
      )
    }

    const baseContext = await resolveTradingProviderContext({
      requestData: {
        provider: order.provider,
        credentialId,
        credentialServiceId,
      },
      requestId,
      userId: auth.userId,
    })
    if (baseContext instanceof Response) {
      return baseContext
    }

    const detailInput: TradingOrderDetailInput = {
      orderId,
      provider: order.provider,
      environment: baseContext.environment,
      accessToken: baseContext.accessToken,
    }
    const providerDetail = await executeTradingProviderOrderDetailRequest(
      order.provider,
      order as TradingOrderHistoryRecord,
      detailInput
    )

    return NextResponse.json({
      data: {
        appOrderId: order.id,
        logId: order.logId,
        orderId,
        orderDetail: providerDetail.orderDetail,
        provider: order.provider,
        providerOrderId: providerDetail.providerOrderId,
        providerDetail,
        workspaceId: order.workspaceId,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch provider order detail`, { error })
    return NextResponse.json({ error: 'Failed to fetch provider order detail' }, { status: 500 })
  }
}
