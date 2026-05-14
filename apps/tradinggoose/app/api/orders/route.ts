import { db, orderHistoryTable } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import {
  DEFAULT_ORDERS_FILTER_STATE,
  normalizeOrdersFilterState,
} from '@/lib/records/order-filters'
import {
  buildOrderOrderBy,
  buildOrderWhereCondition,
  serializeOrderRecord,
} from '@/lib/trading/order-records'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OrdersAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const parseLimit = (value: string | null) => {
  const parsed = value ? Number.parseInt(value, 10) : 50
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50
}

const parseOffset = (value: string | null) => {
  const parsed = value ? Number.parseInt(value, 10) : 0
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')?.trim()
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const access = await checkWorkspaceAccess(workspaceId, session.user.id)
    if (!access.exists || !access.hasAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const limit = parseLimit(searchParams.get('limit'))
    const offset = parseOffset(searchParams.get('offset'))
    const filters = normalizeOrdersFilterState({
      ...DEFAULT_ORDERS_FILTER_STATE,
      orderSearch: searchParams.get('search') ?? '',
      orderSortBy: searchParams.get('sortBy') ?? undefined,
      orderSortOrder: searchParams.get('sortOrder') ?? undefined,
      provider: searchParams.get('provider') ?? undefined,
      environment: searchParams.get('environment') ?? undefined,
      submissionSource: searchParams.get('submissionSource') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      side: searchParams.get('side') ?? undefined,
      orderType: searchParams.get('orderType') ?? undefined,
      timeInForce: searchParams.get('timeInForce') ?? undefined,
      linkedLog: searchParams.get('linkedLog') ?? undefined,
      startDate: searchParams.get('startDate') ?? undefined,
      endDate: searchParams.get('endDate') ?? undefined,
    })
    const whereCondition = buildOrderWhereCondition(workspaceId, filters, {
      joinedSearchExpressions: [
        sql`COALESCE(${workflowExecutionLogs.workflowSummary}->>'name', '')`,
      ],
    })
    const orderBy = buildOrderOrderBy(filters)

    const baseQuery = () =>
      db
        .select({
          order: orderHistoryTable,
          linkedLog: {
            id: workflowExecutionLogs.id,
            executionId: workflowExecutionLogs.executionId,
            workflowSummary: workflowExecutionLogs.workflowSummary,
            level: workflowExecutionLogs.level,
            startedAt: workflowExecutionLogs.startedAt,
            endedAt: workflowExecutionLogs.endedAt,
          },
        })
        .from(orderHistoryTable)
        .leftJoin(
          workflowExecutionLogs,
          and(
            eq(orderHistoryTable.logId, workflowExecutionLogs.id),
            eq(orderHistoryTable.workspaceId, workflowExecutionLogs.workspaceId)
          )
        )

    const rows = await baseQuery()
      .where(whereCondition)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset)

    const [totalRow] = await db
      .select({ total: sql<number>`count(*)` })
      .from(orderHistoryTable)
      .leftJoin(
        workflowExecutionLogs,
        and(
          eq(orderHistoryTable.logId, workflowExecutionLogs.id),
          eq(orderHistoryTable.workspaceId, workflowExecutionLogs.workspaceId)
        )
      )
      .where(whereCondition)

    const total = Number(totalRow?.total ?? 0)
    const pageRecords = rows.map((row) =>
      serializeOrderRecord({ ...row.order, linkedLog: row.linkedLog })
    )

    return NextResponse.json({
      data: pageRecords,
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch orders`, { error })
    return NextResponse.json({ error: 'Failed to fetch order records' }, { status: 500 })
  }
}
