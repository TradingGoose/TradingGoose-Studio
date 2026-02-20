import { db, webhook } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  INDICATOR_MONITOR_TRIGGER_ID,
  IndicatorMonitorMutationSchema,
  type IndicatorMonitorProviderConfig,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { notifyIndicatorMonitorsReconcile } from '@/app/api/indicator-monitors/reconcile'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import {
  ensureIndicatorTriggerBlock,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  getIndicatorMonitorRowById,
  toIndicatorMonitorRecord,
} from '../shared'

const logger = createLogger('IndicatorMonitorByIdAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UpdateMonitorSchema = IndicatorMonitorMutationSchema.partial().extend({
  workspaceId: z.string().min(1),
})

const clientErrorPatterns = ['Missing', 'Invalid', 'not found', 'must be', 'does not', 'Unable to']

const isClientError = (message: string, error: unknown) =>
  error instanceof Error &&
  clientErrorPatterns.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))

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
    const row = await getIndicatorMonitorRowById(id)
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

    return NextResponse.json({ data: toIndicatorMonitorRecord(row.webhook) }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to load indicator monitor`, { error })
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
    const row = await getIndicatorMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = UpdateMonitorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const payload = parsed.data
    const workspaceId = payload.workspaceId || row.workflow.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const existingConfig = (row.webhook.providerConfig || {}) as IndicatorMonitorProviderConfig
    const existingMonitor = existingConfig.monitor
    if (!existingMonitor) {
      return NextResponse.json({ error: 'Invalid existing monitor config' }, { status: 500 })
    }

    const nextWorkflowId = payload.workflowId ?? row.webhook.workflowId
    const nextBlockId = payload.blockId ?? row.webhook.blockId
    if (!nextBlockId) {
      return NextResponse.json({ error: 'blockId is required' }, { status: 400 })
    }

    await ensureWorkflowInWorkspace(nextWorkflowId, workspaceId)
    await ensureIndicatorTriggerBlock(nextWorkflowId, nextBlockId)
    await ensureTriggerCapableIndicator(
      workspaceId,
      payload.indicatorId ?? existingMonitor.indicatorId
    )

    const providerConfig = await normalizeIndicatorMonitorConfig({
      providerId: payload.providerId ?? existingMonitor.providerId,
      interval: payload.interval ?? existingMonitor.interval,
      listingInput: payload.listing ?? existingMonitor.listing,
      indicatorId: payload.indicatorId ?? existingMonitor.indicatorId,
      authInput: payload.auth,
      providerParams: payload.providerParams ?? existingMonitor.providerParams,
      previousAuth: existingMonitor.auth,
    })

    const [updatedMonitor] = await db
      .update(webhook)
      .set({
        workflowId: nextWorkflowId,
        blockId: nextBlockId,
        providerConfig: {
          ...providerConfig,
          triggerId: INDICATOR_MONITOR_TRIGGER_ID,
        },
        isActive: payload.isActive ?? row.webhook.isActive,
        updatedAt: new Date(),
      })
      .where(and(eq(webhook.id, id), eq(webhook.provider, 'indicator')))
      .returning()

    await notifyIndicatorMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ data: toIndicatorMonitorRecord(updatedMonitor) }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    logger.error(`[${requestId}] Failed to update indicator monitor`, { error })
    if (isClientError(message, error)) {
      return NextResponse.json({ error: message }, { status: 400 })
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
    const row = await getIndicatorMonitorRowById(id)
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

    await db.delete(webhook).where(and(eq(webhook.id, id), eq(webhook.provider, 'indicator')))
    await notifyIndicatorMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to delete indicator monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
