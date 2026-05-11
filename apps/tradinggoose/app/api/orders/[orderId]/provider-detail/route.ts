import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'
import {
  resolveTradingProviderContext,
  resolveTradingProviderSelectedAccount,
} from '@/app/api/providers/trading/shared'
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
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = new URL(request.url).searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      accountId?: string
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

    const baseContext = await resolveTradingProviderContext({
      requestData: {
        provider: order.provider,
        credentialServiceId:
          getTradingProviderOAuthServiceIdForEnvironment(order.provider, order.environment) ??
          undefined,
      },
      requestId,
      userId: session.user.id,
    })
    if (baseContext instanceof Response) {
      return baseContext
    }

    const candidateAccountId = body.accountId ?? readOrderAccountId(order)
    let accountId = candidateAccountId ?? undefined
    if (candidateAccountId) {
      const accountContext = await resolveTradingProviderSelectedAccount({
        baseContext,
        accountId: candidateAccountId,
      })
      if (accountContext instanceof Response) {
        return accountContext
      }
      accountId = accountContext.accountId
    } else if (order.provider === 'tradier') {
      return NextResponse.json(
        { error: 'accountId is required for Tradier order detail' },
        { status: 400 }
      )
    }

    const detailInput: TradingOrderDetailInput = {
      orderId,
      provider: order.provider,
      environment: baseContext.environment,
      accessToken: baseContext.accessToken,
      accountId,
    }
    const providerDetail = await executeTradingProviderOrderDetailRequest(
      order.provider,
      order as TradingOrderHistoryRecord,
      detailInput
    )

    return NextResponse.json({
      data: {
        orderId,
        provider: order.provider,
        providerDetail,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch provider order detail`, { error })
    return NextResponse.json({ error: 'Failed to fetch provider order detail' }, { status: 500 })
  }
}
