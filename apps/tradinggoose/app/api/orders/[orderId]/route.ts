import { db, orderHistoryTable } from '@tradinggoose/db'
import { workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { serializeOrderRecord } from '@/lib/trading/order-records'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OrderDetailAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
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

    const { orderId } = await params
    const [row] = await db
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
      .where(and(eq(orderHistoryTable.id, orderId), eq(orderHistoryTable.workspaceId, workspaceId)))
      .limit(1)

    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: serializeOrderRecord({ ...row.order, linkedLog: row.linkedLog }, 'full'),
    })
  } catch (error) {
    logger.error(`[${requestId}] Failed to fetch order detail`, { error })
    return NextResponse.json({ error: 'Failed to fetch order detail' }, { status: 500 })
  }
}
