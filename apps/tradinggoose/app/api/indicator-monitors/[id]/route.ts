import { db, webhook } from '@tradinggoose/db'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  INDICATOR_MONITOR_TRIGGER_ID,
  type IndicatorMonitorProviderConfig,
  IndicatorMonitorUpdateSchema,
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
  getIndicatorMonitorRowById,
  loadIndicatorInputMetadata,
  toIndicatorMonitorRecord,
} from '../shared'

const logger = createLogger('IndicatorMonitorByIdAPI')

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

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

    return NextResponse.json({ data: await toIndicatorMonitorRecord(row.webhook) }, { status: 200 })
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
    const parsed = IndicatorMonitorUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
        { status: 400 }
      )
    }

    const payload = parsed.data
    const workspaceId = row.workflow.workspaceId
    if (!workspaceId) {
      return NextResponse.json({ error: 'Monitor workspace is missing' }, { status: 400 })
    }
    if (payload.workspaceId !== workspaceId) {
      return NextResponse.json(
        { error: 'workspaceId does not match monitor workspace' },
        { status: 400 }
      )
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
    const nextTriggerBlockId = payload.blockId ?? existingMonitor.triggerBlockId
    if (!nextTriggerBlockId) {
      return NextResponse.json({ error: 'blockId is required' }, { status: 400 })
    }

    const workflowRow = await ensureWorkflowInWorkspace(nextWorkflowId, workspaceId)
    if (
      payload.blockId !== undefined ||
      payload.workflowId !== undefined ||
      payload.isActive === true
    ) {
      await ensureIndicatorTriggerBlockInDeployedState(nextWorkflowId, nextTriggerBlockId)
    }
    const nextProviderId = payload.providerId ?? existingMonitor.providerId
    const providerChanged = nextProviderId !== existingMonitor.providerId
    const nextIndicatorId = payload.indicatorId ?? existingMonitor.indicatorId
    const indicatorChanged = nextIndicatorId !== existingMonitor.indicatorId
    const authProvided = Object.hasOwn(payload, 'auth')
    const providerParamsProvided = Object.hasOwn(payload, 'providerParams')
    const indicatorInputsProvided = Object.hasOwn(payload, 'indicatorInputs')
    const shouldNormalizeIndicatorInputs = indicatorInputsProvided || indicatorChanged

    await ensureTriggerCapableIndicator(workspaceId, nextIndicatorId)
    const indicatorMetadata = shouldNormalizeIndicatorInputs
      ? await loadIndicatorInputMetadata(workspaceId, nextIndicatorId)
      : null

    const nextProviderParams = providerChanged
      ? providerParamsProvided
        ? (payload.providerParams ?? {})
        : undefined
      : providerParamsProvided
        ? (payload.providerParams ?? {})
        : existingMonitor.providerParams
    const nextIndicatorInputs = shouldNormalizeIndicatorInputs
      ? indicatorInputsProvided
        ? (payload.indicatorInputs ?? {})
        : {}
      : undefined

    const providerConfig = await normalizeIndicatorMonitorConfig({
      triggerBlockId: nextTriggerBlockId,
      providerId: nextProviderId,
      interval: payload.interval ?? existingMonitor.interval,
      listingInput: payload.listing ?? existingMonitor.listing,
      indicatorId: nextIndicatorId,
      authInput: authProvided ? payload.auth : undefined,
      providerParams: nextProviderParams,
      indicatorInputs: nextIndicatorInputs,
      indicatorInputMeta: indicatorMetadata?.inputMeta,
      previousAuth: providerChanged ? undefined : existingMonitor.auth,
    })
    if (!shouldNormalizeIndicatorInputs && typeof existingMonitor.indicatorInputs !== 'undefined') {
      providerConfig.monitor.indicatorInputs = existingMonitor.indicatorInputs
    }

    const nextIsActive =
      payload.isActive === undefined
        ? row.webhook.isActive
        : payload.isActive && workflowRow.isDeployed

    const [updatedMonitor] = await db
      .update(webhook)
      .set({
        workflowId: nextWorkflowId,
        blockId: null,
        providerConfig: {
          ...providerConfig,
          triggerId: INDICATOR_MONITOR_TRIGGER_ID,
        },
        isActive: nextIsActive,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(webhook.id, id),
          eq(webhook.provider, 'indicator'),
          eq(webhook.workflowId, row.workflow.id)
        )
      )
      .returning()

    void notifyIndicatorMonitorsReconcile({ requestId, logger })

    if (!updatedMonitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    return NextResponse.json(
      { data: await toIndicatorMonitorRecord(updatedMonitor) },
      { status: 200 }
    )
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
    void notifyIndicatorMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Failed to delete indicator monitor`, { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
