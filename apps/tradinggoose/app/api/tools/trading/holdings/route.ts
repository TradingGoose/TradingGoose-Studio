import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { isTradingServiceError } from '@/lib/trading/errors'
import { getTradingHoldings, type TradingHoldingsRequest } from '@/lib/trading/holdings'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TradingHoldingsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }

    let body: TradingHoldingsRequest
    try {
      body = (await request.json()) as TradingHoldingsRequest
    } catch {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid JSON in request body' } },
        { status: 400 }
      )
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: { message: 'Invalid request body' } },
        { status: 400 }
      )
    }

    const searchParams = new URL(request.url).searchParams
    const workspaceId = searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }
    const workflowId = searchParams.get('workflowId')?.trim() || undefined

    const holdings = await getTradingHoldings({
      requestData: { ...body, workflowId },
      requestId,
      userId: auth.userId,
      workspaceId,
    })

    return NextResponse.json({ success: true, data: holdings }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch holdings'
    logger.error(`[${requestId}] Failed to fetch holdings`, { error: message })
    return NextResponse.json(
      { success: false, error: { message } },
      { status: isTradingServiceError(error) ? error.status : 500 }
    )
  }
}
