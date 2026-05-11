import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq, gte, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
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
    const workspaceId = url.searchParams.get('workspaceId')
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')

    if (!workspaceId) {
      return NextResponse.json(
        { success: false, error: { message: 'workspaceId is required' } },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, auth.userId)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 })
    }

    if (!startDate || !endDate) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'startDate and endDate are required',
          },
        },
        { status: 400 }
      )
    }

    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'startDate and endDate must be valid ISO timestamps',
          },
        },
        { status: 400 }
      )
    }

    const history = await db
      .select()
      .from(orderHistoryTable)
      .where(
        and(
          eq(orderHistoryTable.workspaceId, workspaceId),
          gte(orderHistoryTable.recordedAt, start),
          lte(orderHistoryTable.recordedAt, end)
        )
      )
      .orderBy(orderHistoryTable.recordedAt)

    return NextResponse.json(
      {
        success: true,
        data: {
          history,
          count: history.length,
          workspaceId,
          startDate,
          endDate,
        },
      },
      { status: 200 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to fetch order history`, { error })
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to fetch order history',
        },
      },
      { status: 500 }
    )
  }
}
