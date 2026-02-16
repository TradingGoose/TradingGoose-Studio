import { db, orderHistoryTable } from '@tradinggoose/db'
import { and, eq, gte, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OrderHistoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const url = new URL(request.url)
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')
    const workflowId = url.searchParams.get('workflowId')

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

    let conditions = and(
      gte(orderHistoryTable.recordedAt, start),
      lte(orderHistoryTable.recordedAt, end)
    )

    if (workflowId) {
      conditions = and(conditions, eq(orderHistoryTable.workflowId, workflowId))
    }

    const history = await db
      .select()
      .from(orderHistoryTable)
      .where(conditions)
      .orderBy(orderHistoryTable.recordedAt)

    return NextResponse.json(
      {
        success: true,
        data: {
          history,
          count: history.length,
          workflowId: workflowId || null,
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

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const body = await request.json()

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Request body is required',
          },
        },
        { status: 400 }
      )
    }

    const provider = body.provider
    const orderRequest = body.request
    const orderResponse = body.response
    const recordedAtRaw = body.recordedAt

    if (!provider) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'provider is required',
          },
        },
        { status: 400 }
      )
    }

    if (!orderRequest || !orderResponse) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'request and response are required',
          },
        },
        { status: 400 }
      )
    }

    let recordedAt: Date | undefined
    if (recordedAtRaw) {
      const parsed = new Date(recordedAtRaw)
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json(
          {
            success: false,
            error: {
              message: 'recordedAt must be a valid ISO timestamp',
            },
          },
          { status: 400 }
        )
      }
      recordedAt = parsed
    }

    const [record] = await db
      .insert(orderHistoryTable)
      .values({
        provider,
        environment: body.environment,
        recordedAt,
        workflowId: body.workflowId,
        workflowExecutionId: body.workflowExecutionId,
        listingIdentity: body.listingIdentity,
        request: orderRequest,
        response: orderResponse,
        normalizedOrder: body.normalizedOrder,
      })
      .returning()

    return NextResponse.json(
      {
        success: true,
        data: {
          record,
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    logger.error(`[${requestId}] Failed to record order history`, { error })
    return NextResponse.json(
      {
        success: false,
        error: {
          message: error.message || 'Failed to record order history',
        },
      },
      { status: 500 }
    )
  }
}
