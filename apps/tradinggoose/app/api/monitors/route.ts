import { db, webhook } from '@tradinggoose/db'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { resolveOAuthCredentialAccountForUser } from '@/lib/credentials/oauth'
import {
  IndicatorMonitorCreateSchema,
  normalizeIndicatorMonitorConfig,
} from '@/lib/indicators/monitor-config'
import { createLogger } from '@/lib/logs/console/logger'
import {
  normalizePortfolioMonitorConfig,
  PortfolioMonitorCreateSchema,
} from '@/lib/monitors/portfolio-config'
import {
  INDICATOR_MONITOR_PROVIDER,
  INDICATOR_MONITOR_TRIGGER_ID,
  isMonitorProvider,
  type MonitorWebhookProvider,
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
  listMonitorRows,
  loadIndicatorInputMetadata,
  toMonitorRecord,
} from './shared'

const logger = createLogger('MonitorsAPI')

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
    const source = searchParams.get('source')?.trim() || undefined

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 })
    }

    const permission = await checkWorkspacePermission({
      userId: auth.userId,
      workspaceId,
      responseShape: 'errorOnly',
    })
    if (!permission.ok) return permission.response

    if (source && !isMonitorProvider(source)) {
      return NextResponse.json({ error: 'Invalid monitor source' }, { status: 400 })
    }

    const rows = await listMonitorRows({
      workspaceId,
      workflowId,
      blockId,
      source: source as MonitorWebhookProvider | undefined,
    })
    return NextResponse.json(
      {
        data: await Promise.all(rows.map((row) => toMonitorRecord(row.webhook))),
      },
      { status: 200 }
    )
  } catch (error) {
    logger.error(`[${requestId}] Failed to list monitors`, { error })
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
    const source = body && typeof body === 'object' ? (body as { source?: unknown }).source : null
    if (!isMonitorProvider(source)) {
      return NextResponse.json({ error: 'source is required' }, { status: 400 })
    }

    if (source === PORTFOLIO_MONITOR_PROVIDER) {
      return createPortfolioMonitor({ body, requestId, userId: auth.userId })
    }

    const parsed = IndicatorMonitorCreateSchema.safeParse(body)
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
    await ensureMonitorTriggerBlockInDeployedState(
      payload.workflowId,
      payload.blockId,
      INDICATOR_MONITOR_TRIGGER_ID
    )
    await ensureTriggerCapableIndicator(payload.workspaceId, payload.indicatorId)
    const indicatorMetadata = await loadIndicatorInputMetadata(
      payload.workspaceId,
      payload.indicatorId
    )
    const nextIsActive = (payload.isActive ?? true) && workflowRow.isDeployed === true

    const providerConfig = await normalizeIndicatorMonitorConfig({
      triggerBlockId: payload.blockId,
      providerId: payload.providerId,
      interval: payload.interval,
      listingInput: payload.listing,
      indicatorId: payload.indicatorId,
      authInput: payload.auth,
      providerParams: payload.providerParams,
      indicatorInputs: payload.indicatorInputs,
      indicatorInputMeta: indicatorMetadata.inputMeta,
      requireCompleteAuth: nextIsActive,
    })

    const monitorId = nanoid()
    const monitorPath = `monitor-${monitorId}`

    const [createdMonitor] = await db
      .insert(webhook)
      .values({
        id: monitorId,
        workflowId: payload.workflowId,
        blockId: null,
        path: monitorPath,
        provider: INDICATOR_MONITOR_PROVIDER,
        providerConfig,
        isActive: nextIsActive,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    void notifyMonitorsReconcile({ requestId, logger })

    return NextResponse.json({ data: await toMonitorRecord(createdMonitor) }, { status: 201 })
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

    logger.error(`[${requestId}] Failed to create monitor`, { error })
    if (isClientError) {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function createPortfolioMonitor({
  body,
  requestId,
  userId,
}: {
  body: unknown
  requestId: string
  userId: string
}) {
  const parsed = PortfolioMonitorCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message ?? 'Invalid request' },
      { status: 400 }
    )
  }

  const payload = parsed.data
  const permission = await checkWorkspacePermission({
    userId,
    workspaceId: payload.workspaceId,
    requireWrite: true,
    responseShape: 'errorOnly',
  })
  if (!permission.ok) return permission.response

  const workflowRow = await ensureWorkflowInWorkspace(payload.workflowId, payload.workspaceId)
  await ensureMonitorTriggerBlockInDeployedState(
    payload.workflowId,
    payload.blockId,
    PORTFOLIO_MONITOR_TRIGGER_ID
  )

  const serviceId = getTradingProviderOAuthServiceId(payload.providerId, payload.serviceId)
  if (!serviceId) {
    return NextResponse.json({ error: 'Trading provider connection is required' }, { status: 400 })
  }

  const credentialAccess = await resolveOAuthCredentialAccountForUser({
    credentialId: payload.credentialId,
    userId,
    workspaceId: payload.workspaceId,
  })
  if (!credentialAccess || credentialAccess.providerId !== serviceId) {
    return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
  }

  const accounts = await listTradingPortfolioIdentities({
    userId,
    workspaceId: payload.workspaceId,
    providerId: payload.providerId,
    serviceId,
    requestId,
  })
  const account = accounts.find(
    (candidate) =>
      candidate.credentialId === payload.credentialId && candidate.accountId === payload.accountId
  )
  if (!account) {
    return NextResponse.json({ error: 'Trading account not found' }, { status: 404 })
  }

  const nextIsActive = (payload.isActive ?? true) && workflowRow.isDeployed === true
  const providerConfig = normalizePortfolioMonitorConfig({
    triggerBlockId: payload.blockId,
    providerId: payload.providerId,
    serviceId,
    credentialId: payload.credentialId,
    accountId: payload.accountId,
    condition: payload.condition,
    fireMode: payload.fireMode,
    cooldownSeconds: payload.cooldownSeconds,
    pollIntervalSeconds: payload.pollIntervalSeconds,
  })

  const monitorId = nanoid()
  const [createdMonitor] = await db
    .insert(webhook)
    .values({
      id: monitorId,
      workflowId: payload.workflowId,
      blockId: null,
      path: `monitor-${monitorId}`,
      provider: PORTFOLIO_MONITOR_PROVIDER,
      providerConfig,
      isActive: nextIsActive,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()

  void notifyMonitorsReconcile({ requestId, logger })

  return NextResponse.json({ data: await toMonitorRecord(createdMonitor) }, { status: 201 })
}
