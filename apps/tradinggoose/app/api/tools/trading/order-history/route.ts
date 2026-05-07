import { db, orderHistoryTable } from '@tradinggoose/db'
import { workflow, workflowExecutionLogs } from '@tradinggoose/db/schema'
import { and, eq, gte, lte } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { checkWorkspaceAccess } from '@/lib/permissions/utils'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('OrderHistoryAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ORDER_SUBMISSION_SOURCES = ['manual', 'copilot', 'workflow'] as const
type OrderSubmissionSource = (typeof ORDER_SUBMISSION_SOURCES)[number]

const isOrderSubmissionSource = (value: string): value is OrderSubmissionSource =>
  (ORDER_SUBMISSION_SOURCES as readonly string[]).includes(value)

const readString = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

async function readWorkflowWorkspaceId(workflowId: string) {
  const [row] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(eq(workflow.id, workflowId))
    .limit(1)

  return row?.workspaceId?.trim() || null
}

async function resolveWorkflowLogId(params: {
  workspaceId: string
  workflowLogId: string
  workflowExecutionId: string
}) {
  if (params.workflowLogId) {
    const [log] = await db
      .select({ id: workflowExecutionLogs.id, workspaceId: workflowExecutionLogs.workspaceId })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, params.workflowLogId))
      .limit(1)

    if (!log || log.workspaceId !== params.workspaceId) {
      return { ok: false as const, error: 'workflowLogId does not belong to the workspace' }
    }

    return { ok: true as const, workflowLogId: log.id }
  }

  if (!params.workflowExecutionId) {
    return { ok: true as const, workflowLogId: null }
  }

  const [log] = await db
    .select({ id: workflowExecutionLogs.id })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, params.workflowExecutionId),
        eq(workflowExecutionLogs.workspaceId, params.workspaceId)
      )
    )
    .limit(1)

  return { ok: true as const, workflowLogId: log?.id ?? null }
}

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
    const workflowId = url.searchParams.get('workflowId')

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

    if (workflowId) {
      const workflowWorkspaceId = await readWorkflowWorkspaceId(workflowId)
      if (!workflowWorkspaceId) {
        return NextResponse.json(
          { success: false, error: { message: 'Workflow not found' } },
          { status: 404 }
        )
      }
      if (workflowWorkspaceId !== workspaceId) {
        return NextResponse.json(
          { success: false, error: { message: 'workflowId does not belong to workspaceId' } },
          { status: 400 }
        )
      }
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
      eq(orderHistoryTable.workspaceId, workspaceId),
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
    const bodyWorkspaceId = readString(body.workspaceId)
    const workflowId = readString(body.workflowId)
    const submissionSource = readString(body.submissionSource)
    const workflowExecutionId = readString(body.workflowExecutionId)
    const requestedWorkflowLogId = readString(body.workflowLogId)
    const orderRequest = body.request
    const orderResponse = body.response
    const recordedAtRaw = body.recordedAt

    const workspaceId = bodyWorkspaceId
    if (!workspaceId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'workspaceId is required',
          },
        },
        { status: 400 }
      )
    }

    const access = await checkWorkspaceAccess(workspaceId, auth.userId)
    if (!access.exists || !access.canWrite) {
      return NextResponse.json({ success: false, error: { message: 'Not found' } }, { status: 404 })
    }

    if (workflowId) {
      const workflowWorkspaceId = await readWorkflowWorkspaceId(workflowId)
      if (!workflowWorkspaceId) {
        return NextResponse.json(
          { success: false, error: { message: 'Workflow not found' } },
          { status: 404 }
        )
      }
      if (workflowWorkspaceId !== workspaceId) {
        return NextResponse.json(
          { success: false, error: { message: 'workflowId does not belong to workspaceId' } },
          { status: 400 }
        )
      }
    }

    if (!isOrderSubmissionSource(submissionSource)) {
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'submissionSource must be manual, copilot, or workflow',
          },
        },
        { status: 400 }
      )
    }

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

    const resolvedWorkflowLog = await resolveWorkflowLogId({
      workspaceId,
      workflowLogId: requestedWorkflowLogId,
      workflowExecutionId,
    })

    if (!resolvedWorkflowLog.ok) {
      return NextResponse.json(
        { success: false, error: { message: resolvedWorkflowLog.error } },
        { status: 400 }
      )
    }

    const [record] = await db
      .insert(orderHistoryTable)
      .values({
        workspaceId,
        provider,
        environment: body.environment,
        recordedAt,
        submissionSource,
        workflowId: workflowId || null,
        workflowExecutionId: workflowExecutionId || null,
        workflowLogId: resolvedWorkflowLog.workflowLogId,
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
