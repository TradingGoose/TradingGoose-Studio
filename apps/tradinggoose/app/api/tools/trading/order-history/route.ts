import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { isTradingServiceError } from '@/lib/trading/errors'
import { listTradingOrderHistory } from '@/lib/trading/order-history'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OrderHistoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const data = await listTradingOrderHistory({
      workspaceId: url.searchParams.get('workspaceId'),
      startDate: url.searchParams.get('startDate'),
      endDate: url.searchParams.get('endDate'),
      userId: auth.userId,
    })

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { status: 200 }
    )
  } catch (error) {
    if (isTradingServiceError(error)) {
      return NextResponse.json(
        { success: false, error: { message: error.message } },
        { status: error.status }
      )
    }
    logger.error(`[${requestId}] Failed to fetch order history`, { error })
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to fetch order history',
        },
      },
      { status: 500 }
    )
  }
}
