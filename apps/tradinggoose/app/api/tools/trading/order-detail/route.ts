import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { executeTradingProviderOrderDetailRequest } from '@/providers/trading'
import type { TradingOrderDetailInput, TradingOrderHistoryRecord } from '@/providers/trading/types'
import type { TradingOrderDetailParams } from '@/tools/trading/types'

const logger = createLogger('TradingOrderDetailAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const isLikelyClientInputError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('required') ||
    message.includes('missing') ||
    message.includes('invalid') ||
    message.includes('mismatch')
  )
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = (await request.json().catch(() => null)) as TradingOrderDetailParams | null
    const orderId = typeof body?.orderId === 'string' ? body.orderId.trim() : ''

    if (!orderId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'orderId is required',
          },
        },
        { status: 400 }
      )
    }

    const workflowId = new URL(request.url).searchParams.get('workflowId')
    const whereClause = workflowId
      ? and(eq(orderHistoryTable.id, orderId), eq(orderHistoryTable.workflowId, workflowId))
      : eq(orderHistoryTable.id, orderId)

    const [historyRecord] = await db.select().from(orderHistoryTable).where(whereClause).limit(1)

    if (!historyRecord) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Order history record not found',
          },
        },
        { status: 404 }
      )
    }

    if (body?.provider && body.provider !== historyRecord.provider) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: `Provided provider "${body.provider}" does not match the order provider "${historyRecord.provider}".`,
          },
        },
        { status: 400 }
      )
    }

    const resolved = await executeTradingProviderOrderDetailRequest(
      historyRecord.provider,
      historyRecord as TradingOrderHistoryRecord,
      (body || { orderId }) as TradingOrderDetailInput
    )

    return NextResponse.json(
      {
        success: true,
        data: {
          orderHistoryRecord: historyRecord,
          provider: historyRecord.provider,
          appOrderId: historyRecord.id,
          providerOrderId: resolved.providerOrderId,
          orderDetail: resolved.orderDetail,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    const upstreamStatus = typeof error?.status === 'number' ? error.status : null
    const status = upstreamStatus ?? (isLikelyClientInputError(error) ? 400 : 500)
    const errorMessage =
      error instanceof Error && error.message ? error.message : 'Failed to fetch order detail'

    logger.error(`[${requestId}] Failed to fetch order detail`, {
      error: errorMessage,
      status,
      details: error?.details,
    })

    return NextResponse.json(
      {
        success: false,
        error: {
          message: errorMessage,
          details: error?.details,
        },
      },
      { status }
    )
  }
}
