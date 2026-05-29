import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { isTradingServiceError } from '@/lib/trading/errors'
import {
  getTradingPortfolioDetail,
  type TradingPortfolioDetailRequest,
} from '@/lib/trading/portfolio-detail'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TradingPortfolioDetailAPI')

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

    let body: TradingPortfolioDetailRequest
    try {
      body = (await request.json()) as TradingPortfolioDetailRequest
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
    const workflowId = searchParams.get('workflowId')?.trim() || undefined
    const workspaceId = searchParams.get('workspaceId')?.trim() || undefined
    if (!workflowId && !workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }

    const portfolioDetail = await getTradingPortfolioDetail({
      requestData: {
        ...body,
        workspaceId: body.workspaceId ?? workspaceId,
      },
      requestId,
      userId: auth.userId,
    })

    return NextResponse.json({ success: true, data: portfolioDetail }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch portfolio detail'
    logger.error(`[${requestId}] Failed to fetch portfolio detail`, { error: message })
    return NextResponse.json(
      { success: false, error: { message } },
      { status: isTradingServiceError(error) ? error.status : 500 }
    )
  }
}
