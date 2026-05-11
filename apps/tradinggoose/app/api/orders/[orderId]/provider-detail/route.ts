import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { isTradingServiceError } from '@/lib/trading/errors'
import { getRecordedTradingOrderProviderDetail } from '@/lib/trading/order-detail'
import { generateRequestId } from '@/lib/utils'

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

    const { orderId } = await params
    const providerDetail = await getRecordedTradingOrderProviderDetail({
      orderId,
      requestId,
      userId: auth.userId,
      workspaceId,
    })

    return NextResponse.json({ data: providerDetail })
  } catch (error) {
    if (isTradingServiceError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    logger.error(`[${requestId}] Failed to fetch provider order detail`, { error })
    return NextResponse.json({ error: 'Failed to fetch provider order detail' }, { status: 500 })
  }
}
