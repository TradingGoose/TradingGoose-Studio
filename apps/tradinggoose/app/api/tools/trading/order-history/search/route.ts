import { db, orderHistoryTable } from '@tradinggoose/db'
import { desc } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { buildOrderWhereCondition, serializeOrderSearchOptions } from '@/lib/trading/order-records'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('TradingOrderHistorySearchAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_LIMIT = 20
const DEFAULT_LIMIT = 20

const parseLimit = (value: string | null): number => {
  if (!value) return DEFAULT_LIMIT
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json(
        { success: false, error: { message: 'Unauthorized' } },
        { status: 401 }
      )
    }

    const url = new URL(request.url)
    const workspaceId = url.searchParams.get('workspaceId')?.trim() ?? ''
    const query = url.searchParams.get('q')?.trim() ?? ''
    const limit = parseLimit(url.searchParams.get('limit'))

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 })
    }

    const rows = await db
      .select()
      .from(orderHistoryTable)
      .where(buildOrderWhereCondition(workspaceId, { orderSearch: query }))
      .orderBy(desc(orderHistoryTable.recordedAt))
      .limit(limit)

    const results = await serializeOrderSearchOptions(rows)

    return NextResponse.json(
      {
        success: true,
        data: {
          results,
          count: results.length,
          workspaceId,
          query,
          limit,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to search order history records`, { error })

    return NextResponse.json(
      {
        success: false,
        error: {
          message: error instanceof Error ? error.message : 'Failed to search order history',
        },
      },
      { status: 500 }
    )
  }
}
