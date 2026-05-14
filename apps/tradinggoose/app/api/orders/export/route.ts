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

const logger = createLogger('OrdersExportAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ORDER_EXPORT_LIMIT = 5000
const CSV_FORMULA_PREFIX = /^[\s]*[=+\-@]/

const csvValue = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  const safeText = CSV_FORMULA_PREFIX.test(text) ? `'${text}` : text
  return `"${safeText.replace(/"/g, '""')}"`
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

    const rows = await db
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
      .where(whereCondition)
      .orderBy(...orderBy)
      .limit(ORDER_EXPORT_LIMIT + 1)

    if (rows.length > ORDER_EXPORT_LIMIT) {
      return NextResponse.json(
        { error: `Order export is limited to ${ORDER_EXPORT_LIMIT} records` },
        { status: 413 }
      )
    }

    const records = rows.map((row) =>
      serializeOrderRecord({ ...row.order, linkedLog: row.linkedLog })
    )

    const headers = [
      'App Order ID',
      'Provider Order ID',
      'Listing',
      'Submission Source',
      'Provider',
      'Environment',
      'Side',
      'Status',
      'Order Type',
      'Quantity',
      'Filled Quantity',
      'Average Fill Price',
      'Recorded At',
      'Submitted At',
      'Log ID',
    ]
    const lines = [
      headers.map(csvValue).join(','),
      ...records.map((record) =>
        [
          record.id,
          record.providerOrderId,
          record.listing.symbol,
          record.submissionSource,
          record.provider,
          record.environment,
          record.side,
          record.status,
          record.orderType,
          record.quantity,
          record.filledQuantity,
          record.averageFillPrice,
          record.recordedAt,
          record.submittedAt,
          record.logId,
        ]
          .map(csvValue)
          .join(',')
      ),
    ]

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="orders-${timestamp}.csv"`,
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to export order records`, { error })
    return NextResponse.json({ error: 'Failed to export order records' }, { status: 500 })
  }
}
