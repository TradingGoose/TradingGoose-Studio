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
    if (!auth.success) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }

    const body = (await request.json().catch(() => null)) as TradingHoldingsRequest | null
    if (!body?.portfolioIdentity) {
      return NextResponse.json(
        { success: false, error: { message: 'portfolioIdentity is required' } },
        { status: 400 }
      )
    }

    const holdings = await getTradingHoldings(body)

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
