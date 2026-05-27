import { db, webhook } from '@tradinggoose/db'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthCredentialAccountForUser } from '@/lib/credentials/oauth'
import {
  type IndicatorMonitorProviderConfig,
  IndicatorMonitorUpdateSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import {
  normalizePortfolioMonitorConfig,
  type PortfolioMonitorProviderConfig,
  PortfolioMonitorUpdateSchema,
} from '@/lib/monitors/portfolio-config'
import {
  INDICATOR_MONITOR_PROVIDER,
  INDICATOR_MONITOR_TRIGGER_ID,
  MONITOR_WEBHOOK_PROVIDERS,
  PORTFOLIO_MONITOR_PROVIDER,
  PORTFOLIO_MONITOR_TRIGGER_ID,
} from '@/lib/monitors/sources'
import { listTradingPortfolioIdentities } from '@/lib/trading/portfolio-identities'
import { generateRequestId } from '@/lib/utils'
import { authenticateIndicatorRequest, checkWorkspacePermission } from '@/app/api/indicators/utils'
import { notifyMonitorsReconcile } from '@/app/api/monitors/reconcile'
import { getTradingProviderOAuthServiceId } from '@/providers/trading/providers'
import {
  ensureMonitorTriggerBlockInDeployedState,
  ensureTriggerCapableIndicator,
  ensureWorkflowInWorkspace,
  getMonitorRowById,
  loadIndicatorInputMetadata,
  toMonitorRecord,
} from '../shared'

const logger = createLogger('MonitorByIdAPI')

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
    const row = await getMonitorRowById(id)
    if (!row) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    if (row.webhook.provider === PORTFOLIO_MONITOR_PROVIDER) {
      return updatePortfolioMonitor({ id, row, body, requestId, userId: auth.userId })
    }

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
    if (payload.workspaceId !== undefined && payload.workspaceId !== workspaceId) {
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
      await ensureMonitorTriggerBlockInDeployedState(
        nextWorkflowId,
        nextTriggerBlockId,
        INDICATOR_MONITOR_TRIGGER_ID
      )
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
    const nextIsActive =
      payload.isActive === undefined
        ? row.webhook.isActive
        : payload.isActive && workflowRow.isDeployed

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
      requireCompleteAuth: nextIsActive,
    })
    if (!shouldNormalizeIndicatorInputs && typeof existingMonitor.indicatorInputs !== 'undefined') {
      providerConfig.monitor.indicatorInputs = existingMonitor.indicatorInputs
    }

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
          eq(webhook.provider, INDICATOR_MONITOR_PROVIDER),
          eq(webhook.workflowId, row.workflow.id)
        )
      )
      .returning()

    void notifyMonitorsReconcile({ requestId, logger })

    if (!updatedMonitor) {
      return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
    }

    return NextResponse.json({ data: await toMonitorRecord(updatedMonitor) }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error'
    logger.error(`[${requestId}] Failed to update monitor`, { error })
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

async function updatePortfolioMonitor({
  id,
  row,
  body,
  requestId,
  userId,
}: {
  id: string
  row: NonNullable<Awaited<ReturnType<typeof getMonitorRowById>>>
  body: unknown
  requestId: string
  userId: string
}) {
  const parsed = PortfolioMonitorUpdateSchema.safeParse(body)
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
    userId,
    workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  const existingConfig = (row.webhook.providerConfig || {}) as PortfolioMonitorProviderConfig
  const existingMonitor = existingConfig.monitor
  if (!existingMonitor) {
    return NextResponse.json({ error: 'Invalid existing monitor config' }, { status: 500 })
  }

  const nextWorkflowId = payload.workflowId ?? row.webhook.workflowId
  const nextTriggerBlockId = payload.blockId ?? existingMonitor.triggerBlockId
  const workflowRow = await ensureWorkflowInWorkspace(nextWorkflowId, workspaceId)
  if (
    payload.blockId !== undefined ||
    payload.workflowId !== undefined ||
    payload.isActive === true
  ) {
    await ensureMonitorTriggerBlockInDeployedState(
      nextWorkflowId,
      nextTriggerBlockId,
      PORTFOLIO_MONITOR_TRIGGER_ID
    )
  }

  const nextProviderId = payload.providerId ?? existingMonitor.providerId
  const nextServiceId =
    getTradingProviderOAuthServiceId(
      nextProviderId,
      payload.serviceId ?? existingMonitor.serviceId
    ) ?? null
  if (!nextServiceId) {
    return NextResponse.json({ error: 'Trading provider connection is required' }, { status: 400 })
  }
  const nextCredentialId = payload.credentialId ?? existingMonitor.credentialId
  const nextAccountId = payload.accountId ?? existingMonitor.accountId

  const credentialAccess = await resolveOAuthCredentialAccountForUser({
    credentialId: nextCredentialId,
    userId,
    workspaceId,
  })
  if (!credentialAccess || credentialAccess.providerId !== nextServiceId) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
  }

  const accounts = await listTradingPortfolioIdentities({
    userId,
    workspaceId,
    providerId: nextProviderId,
    serviceId: nextServiceId,
    requestId,
  })
  const account = accounts.find(
    (candidate) =>
      candidate.credentialId === nextCredentialId && candidate.accountId === nextAccountId
  )
  if (!account) {
    return NextResponse.json({ error: 'Trading account not found' }, { status: 404 })
  }

  const nextIsActive =
    payload.isActive === undefined
      ? row.webhook.isActive
      : payload.isActive && workflowRow.isDeployed
  const providerConfig = normalizePortfolioMonitorConfig({
    triggerBlockId: nextTriggerBlockId,
    providerId: nextProviderId,
    serviceId: nextServiceId,
    credentialId: nextCredentialId,
    accountId: nextAccountId,
    condition: payload.condition ?? existingMonitor.condition,
    fireMode: payload.fireMode ?? existingMonitor.fireMode,
    cooldownSeconds: payload.cooldownSeconds ?? existingMonitor.cooldownSeconds,
    pollIntervalSeconds: payload.pollIntervalSeconds ?? existingMonitor.pollIntervalSeconds,
  })

  const [updatedMonitor] = await db
    .update(webhook)
    .set({
      workflowId: nextWorkflowId,
      blockId: null,
      providerConfig,
      isActive: nextIsActive,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(webhook.id, id),
        eq(webhook.provider, PORTFOLIO_MONITOR_PROVIDER),
        eq(webhook.workflowId, row.workflow.id)
      )
    )
    .returning()

  void notifyMonitorsReconcile({ requestId, logger })

  if (!updatedMonitor) {
    return NextResponse.json({ error: 'Monitor not found' }, { status: 404 })
  }

  return NextResponse.json({ data: await toMonitorRecord(updatedMonitor) }, { status: 200 })
}
