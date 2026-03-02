import { db, webhook } from '@tradinggoose/db'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import {
  INDICATOR_MONITOR_TRIGGER_ID,
  IndicatorMonitorMutationSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { notifyIndicatorMonitorsReconcile } from '@/app/api/indicator-monitors/reconcile'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import {
  ensureIndicatorTriggerBlockInDeployedState,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  listIndicatorMonitorRows,
  toIndicatorMonitorRecord,
} from './shared'

const logger = createLogger('IndicatorMonitorsAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor list',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const { searchParams } = new URL(request.url)
    const workspaceId = searchParams.get('workspaceId')?.trim()
    const workflowId = searchParams.get('workflowId')?.trim() || undefined
    const blockId = searchParams.get('blockId')?.trim() || undefined

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const rows = await listIndicatorMonitorRows({ workspaceId, workflowId, blockId })
    return NextResponse.json(
      {
        data: await Promise.all(rows.map((row) => toIndicatorMonitorRecord(row.webhook))),
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to list indicator monitors`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const auth = await authenticateIndicatorRequest({
      request,
      requestId,
      logger,
      action: 'monitor create',
      responseShape: 'errorOnly',
    })
    if ('response' in auth) return auth.response

    const body = await request.json().catch(() => ({}))
    const parsed = IndicatorMonitorMutationSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const payload = parsed.data
    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId: payload.workspaceId,
      requireWrite: true,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    const workflowRow = await ensureWorkflowInWorkspace(payload.workflowId, payload.workspaceId)
    await ensureIndicatorTriggerBlockInDeployedState(payload.workflowId, payload.blockId)
    await ensureTriggerCapableIndicator(payload.workspaceId, payload.indicatorId)

    const providerConfig = await normalizeIndicatorMonitorConfig({
      triggerBlockId: payload.blockId,
      providerId: payload.providerId,
      interval: payload.interval,
      listingInput: payload.listing,
      indicatorId: payload.indicatorId,
      authInput: payload.auth,
      providerParams: payload.providerParams,
    })

    const monitorId = nanoid()
    const monitorPath = `indicator-monitor-${monitorId}`

    const nextIsActive = (payload.isActive ?? true) && workflowRow.isDeployed === true

    const [createdMonitor] = await db
      .insert(webhook)
      .values({
        id: monitorId,
        workflowId: payload.workflowId,
        blockId: null,
        path: monitorPath,
        provider: 'indicator',
        providerConfig: {
          ...providerConfig,
          triggerId: INDICATOR_MONITOR_TRIGGER_ID,
        },
        isActive: nextIsActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    void notifyIndicatorMonitorsReconcile({ requestId, logger })

    return NextResponse.json(
      { data: await toIndicatorMonitorRecord(createdMonitor) },
      { status: 201 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    const clientErrorPatterns = [
      'Missing',
      'Invalid',
      'not found',
      'must be',
      'does not',
      'Unable to',
    ]
    const isClientError =
      error instanceof Error &&
      clientErrorPatterns.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()))

    logger.error(`[${requestId}] Failed to create indicator monitor`, { error })
    if (isClientError) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
