import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getOAuthToken } from '@/app/api/auth/oauth/utils'
import { executeTradingHoldings } from '@/tools/trading/holdings'
import type { TradingHoldingsParams } from '@/tools/trading/types'

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

    const body = (await request.json().catch(() => null)) as TradingHoldingsParams | null
    if (!body?.portfolioIdentity) {
      return NextResponse.json(
        { success: false, error: { message: 'portfolioIdentity is required' } },
        { status: 400 }
      )
    }

    const credentialServiceId =
      typeof body.portfolioIdentity === 'object' &&
      body.portfolioIdentity &&
      'credentialServiceId' in body.portfolioIdentity &&
      typeof body.portfolioIdentity.credentialServiceId === 'string'
        ? body.portfolioIdentity.credentialServiceId
        : ''

    if (!credentialServiceId) {
      return NextResponse.json(
        { success: false, error: { message: 'portfolioIdentity.credentialServiceId is required' } },
        { status: 400 }
      )
    }

    const accessToken = await getOAuthToken(auth.userId, credentialServiceId)
    const result = await executeTradingHoldings({ ...body, accessToken })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: { message: result.error || 'Failed to fetch holdings' } },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, data: result.output }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch holdings'
    logger.error(`[${requestId}] Failed to fetch holdings`, { error: message })
    return NextResponse.json({ success: false, error: { message } }, { status: 500 })
  }
}
