import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import { resolveTradingProviderContext } from '@/app/api/providers/trading/shared'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'
import { getTradingProviderOAuthServiceIdForEnvironment } from '@/providers/trading/providers'
import type { TradingOrderDetailInput, TradingOrderHistoryRecord } from '@/providers/trading/types'
import { readOrderAccountId } from '../../order-record-utils'

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

    const body = (await request.json().catch(() => ({}))) as {
      provider?: string
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

    if (body.provider && body.provider !== order.provider) {
      return NextResponse.json(
        {
          error: `Provided provider "${body.provider}" does not match the order provider "${order.provider}".`,
        },
        { status: 400 }
      )
    }

    if (order.provider === 'tradier' && !readOrderAccountId(order)) {
      return NextResponse.json(
        { error: 'Tradier order history record is missing accountId' },
        { status: 400 }
      )
    }

    const baseContext = await resolveTradingProviderContext({
      requestData: {
        provider: order.provider,
        credentialServiceId:
          getTradingProviderOAuthServiceIdForEnvironment(order.provider, order.environment) ??
          undefined,
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
