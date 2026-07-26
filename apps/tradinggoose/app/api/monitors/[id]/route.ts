import { db, webhook } from '@tradinggoose/db'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console/logger'
import { MONITOR_WEBHOOK_PROVIDERS } from '@/lib/monitors/sources'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import {
  getMonitorRowById,
  isMonitorClientError,
  MonitorRequestError,
  toMonitorRecord,
} from '../shared'
import { updateMonitorForUser } from '../update-service'

const logger = createLogger('MonitorByIdAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor read',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    if (!row.workflow.workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId: row.workflow.workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    return NextResponse.json({ data: await toMonitorRecord(row.webhook) }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor update',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const updatedMonitor = await updateMonitorForUser({
      monitorId: id,
      userId: auth.userId,
      body,
      requestId,
      logger,
    })

    return NextResponse.json({ data: updatedMonitor }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    logger.error(`[${requestId}] Failed to update monitor`, { error })
    if (error instanceof MonitorRequestError || isMonitorClientError(message)) {
      return NextResponse.json(
        {
          error: message,
        },
        {
          status: error instanceof MonitorRequestError ? error.status : 400,
        }
      )
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor delete',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { id } = await params
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    if (!row.workflow.workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }

    const workspaceId = row.workflow.workspaceId
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    await db
      .delete(webhook)
      .where(and(eq(webhook.id, id), inArray(webhook.provider, [...MONITOR_WEBHOOK_PROVIDERS])))
    void notifyMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to delete monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
